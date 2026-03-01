import { ethers, Contract, Interface } from 'ethers';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { SaltManager } from './SaltManager.js';
import dotenv from 'dotenv';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const logger = pino({
  name: 'llm-agent',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const ESCROW_ABI = [
  "function joinMatch(uint256 _matchId) payable",
  "function commitMove(uint256 _matchId, bytes32 _commitHash)",
  "function revealMove(uint256 _matchId, uint8 _move, bytes32 _salt)",
  "function getMatch(uint256 _matchId) view returns (address, address, uint256, address, uint8, uint8, uint8, uint8, uint8, uint8, uint256, uint256)",
  "function matchCounter() view returns (uint256)",
  "function getRoundStatus(uint256 _matchId, uint8 _round, address _player) view returns (bytes32 commitHash, bool revealed)",
  "function fiseMatches(uint256) view returns (bytes32)"
];

/**
 * An LLM-powered autonomous agent for the Falken Protocol.
 * Uses Gemini 2.5 to analyze game logic and history.
 */
export class SimpleAgent {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private escrow: Contract;
  private saltManager: SaltManager;
  private escrowAddress: string;
  private genAI: GoogleGenerativeAI;

  constructor(privateKey: string) {
    this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.escrowAddress = process.env.ESCROW_ADDRESS!.toLowerCase();
    this.escrow = new Contract(this.escrowAddress, ESCROW_ABI, this.wallet);
    this.saltManager = new SaltManager();
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  }

  async run() {
    logger.info({ address: this.wallet.address }, '🤖 LLM Agent active');
    
    while (true) {
      try {
        await this.handleMatches();
        await new Promise(resolve => setTimeout(resolve, 20000)); // Poll every 20s
      } catch (e) {
        logger.error(e, 'Agent Loop Error');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }

  async handleMatches() {
    let matchCount = 0;
    try {
      const counter = await this.escrow.matchCounter();
      matchCount = Number(counter);
    } catch (err) {
      logger.warn('Failed to fetch matchCounter, skipping scan.');
      return;
    }

    const start = Math.max(1, matchCount - 20);
    for (let i = start; i <= matchCount; i++) {
      try {
        const [
          playerA, playerB, stake, gameLogic, 
          winsA, winsB, currentRound, drawCounter, 
          phase, status, commitDeadline, revealDeadline
        ] = await this.escrow.getMatch(i);

        const s = Number(status);
        const pA = playerA.toLowerCase();
        const pB = playerB.toLowerCase();
        const myAddress = this.wallet.address.toLowerCase();

        // 1. Discovery: If match is OPEN and we aren't Player A, join it
        if (s === 0 && pA !== myAddress) {
          // JOIN RPS or Liars Dice FISE matches
          let logicId = gameLogic.toLowerCase();
          if (logicId === this.escrowAddress) {
             const fiseEscrow = new Contract(this.escrowAddress, ["function fiseMatches(uint256) view returns (bytes32)"], this.provider);
             logicId = (await fiseEscrow.fiseMatches(i)).toLowerCase();
          }

          if (logicId === '0xf2f80f1811f9e2c534946f0e8ddbdbd5c1e23b6e48772afe3bccdb9f2e1cfdf3' || 
              logicId === '0x2376a7b3448a3b64858d5fcfeca172b49521df5ce706244b0300fdfe653fa28f' ||
              logicId === '0x2db54e16efc4149dedd2d7efcff126fb6bd2c54090ee2b6460af6a7dd252e318') {
            logger.info({ matchId: i, logicId }, 'Found OPEN FISE JS match, joining...');
            await this.joinMatch(i, stake);
          } else {
            logger.debug({ matchId: i, logicId }, 'Skipping match: Logic ID mismatch');
          }
        }

        // 2. Gameplay: If match is ACTIVE and we are a participant, play the round
        if (s === 1 && (pA === myAddress || pB === myAddress)) {
          const now = Math.floor(Date.now() / 1000);
          const deadline = Number(phase) === 0 ? Number(commitDeadline) : Number(revealDeadline);
          
          if (deadline > 0 && now > deadline) {
            logger.warn({ matchId: i, phase: Number(phase) }, 'Match deadline passed, skipping');
            continue;
          }

          logger.debug({ matchId: i, round: Number(currentRound) }, 'Processing active match');
          
          // Re-pack for playRound
          const mData = {
            playerA, playerB, stake, gameLogic, 
            winsA, winsB, currentRound, drawCounter, 
            phase, status: s, commitDeadline, revealDeadline
          };
          await this.playRound(i, mData);
        }
      } catch (err: any) {
        logger.warn({ matchId: i, error: err.message }, 'Error processing match, skipping this match');
      }
    }
  }

  private async joinMatch(matchId: number, stake: bigint) {
    logger.info({ matchId, stake: ethers.formatEther(stake) }, '🤝 Joining match');
    try {
      const tx = await this.escrow.joinMatch(matchId, { value: stake });
      await tx.wait();
      logger.info({ hash: tx.hash }, '✅ Joined match');
    } catch (err) {
      logger.error(err, 'Failed to join match');
    }
  }

  private async playRound(matchId: number, matchData: any) {
    const round = Number(matchData.currentRound);
    const phase = Number(matchData.phase);
    const dbMatchId = `${this.escrowAddress}-${matchId}`;

    const status = await this.escrow.getRoundStatus(matchId, round, this.wallet.address);
    const [commitHash, revealed] = status;

    if (phase === 0 && commitHash === ethers.ZeroHash) {
      // Resolve logicId for strategy
      let logicId = matchData.gameLogic.toLowerCase();
      if (logicId === this.escrowAddress) {
        const fiseEscrow = new Contract(this.escrowAddress, ["function fiseMatches(uint256) view returns (bytes32)"], this.provider);
        logicId = (await fiseEscrow.fiseMatches(matchId)).toLowerCase();
      }

      // Generate salt FIRST so poker strategy can compute hand from it
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const move = await this.getLLMMove(matchId, round, logicId, salt);
      
      const hash = ethers.solidityPackedKeccak256(
        ['string', 'address', 'uint256', 'uint256', 'address', 'uint256', 'bytes32'],
        ["FALKEN_V1", this.escrowAddress, matchId, round, this.wallet.address, move, salt]
      );

      await this.saltManager.saveSalt({ matchId: dbMatchId, round, move, salt });
      logger.info({ matchId, round, move }, '🎲 LLM Committing move');
      const tx = await this.escrow.commitMove(matchId, hash);
      await tx.wait();
    } 
    else if (phase === 1 && !revealed) {
      const entry = await this.saltManager.getSalt(dbMatchId, round);
      if (entry) {
        logger.info({ matchId, round }, '🔓 LLM Revealing move');
        const tx = await this.escrow.revealMove(matchId, entry.move, entry.salt);
        await tx.wait();
      }
    }
  }

  private computePokerHand(address: string, salt: string, round: number): number[] {
    const seedStr = address.toLowerCase() + salt + round;
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
      hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);
      hash |= 0;
    }
    const deck = Array.from({length: 52}, (_, i) => i);
    for (let i = deck.length - 1; i > 0; i--) {
      hash = (Math.imul(1664525, hash) + 1013904223) | 0;
      const j = Math.abs(hash % (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck.slice(0, 5);
  }

  private cardName(card: number): string {
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King', 'Ace'];
    const suits = ['Spades', 'Hearts', 'Diamonds', 'Clubs'];
    return `${ranks[card % 13]} of ${suits[Math.floor(card / 13)]}`;
  }

  async getLLMMove(matchId: number, round: number, logicId: string, salt: string): Promise<number> {
    logger.info({ matchId, round }, '🧠 Querying Gemini 2.5 for strategy...');

    let logicSource = "";
    try {
      if (logicId === '0xf2f80f1811f9e2c534946f0e8ddbdbd5c1e23b6e48772afe3bccdb9f2e1cfdf3') {
        logicSource = fs.readFileSync(path.resolve(__dirname, '../../../rps.js'), 'utf8');
      } else if (logicId === '0x2db54e16efc4149dedd2d7efcff126fb6bd2c54090ee2b6460af6a7dd252e318') {
        logicSource = fs.readFileSync(path.resolve(__dirname, '../../../poker.js'), 'utf8');
      } else {
        logicSource = fs.readFileSync(path.resolve(__dirname, '../../../liarsdice.js'), 'utf8');
      }
    } catch (e) {
      logger.error('Failed to read logic source');
    }

    // For Poker Blitz, compute the actual hand so the LLM can make informed decisions
    let handContext = '';
    if (logicId === '0x2db54e16efc4149dedd2d7efcff126fb6bd2c54090ee2b6460af6a7dd252e318') {
      const hand = this.computePokerHand(this.wallet.address, salt, round);
      const handNames = hand.map((c, i) => `  Index ${i}: ${this.cardName(c)}`);
      handContext = `
      YOUR CURRENT HAND (5 cards dealt to you this round):
${handNames.join('\n')}

      IMPORTANT DISCARD RULES:
      - Respond with "0" to keep all cards
      - Discard at most 2 cards (3+ overflows the uint8 move encoding)
      - List indices in DESCENDING order to avoid leading zeros (e.g., "42" not "24", "30" not "03")
      - Discarded cards are replaced from the deck
      `;
      logger.info({ hand: hand.map(c => this.cardName(c)) }, '🃏 LLM Agent poker hand');
    }

    const { data: history } = await supabase
      .from('rounds')
      .select('*')
      .eq('match_id', `${this.escrowAddress}-${matchId}`)
      .order('round_number', { ascending: true });

    const model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `
      You are a strategic Falken Protocol Agent.

      GAME RULES (JavaScript):
      ${logicSource}
      ${handContext}
      MATCH STATUS:
      - Match ID: ${matchId}
      - Current Round: ${round}
      - History: ${JSON.stringify(history)}

      MOVE FORMAT:
      - RPS: 0=Rock, 1=Paper, 2=Scissors.
      - Liar's Dice: 0=Call Liar, or (Quantity * 10 + Face) for a Bid.
      - Poker Blitz: String of indices to DISCARD (e.g., "024" to discard cards 0, 2, and 4). Respond with "0" to keep all.

      Respond ONLY with a JSON object:
      {
        "reasoning": "your thought",
        "move": "<string_or_integer>"
      }
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    try {
      const json = JSON.parse(text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1));
      let move = Number(json.move);
      // Clamp to uint8: if move > 255, keep only the top 2 discard indices
      if (move > 255) {
        const digits = String(json.move).split('').map(Number).sort((a, b) => b - a);
        move = Number(digits.slice(0, 2).join(''));
        logger.warn({ original: json.move, clamped: move }, '⚠️ Move exceeded uint8, clamped to 2 discards');
      }
      logger.info({ reasoning: json.reasoning, move }, '🧠 Gemini 2.5 Reasoning');
      return move;
    } catch (e) {
      return 0;
    }
  }
}
