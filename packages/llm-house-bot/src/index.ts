import { ethers, Contract, Interface } from 'ethers';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { SaltManager } from 'reference-agent';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const logger = pino({
  name: 'llm-house-bot',
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
  "function createFiseMatch(uint256 stake, bytes32 logicId) payable",
  "function joinMatch(uint256 _matchId) payable",
  "function commitMove(uint256 _matchId, bytes32 _commitHash)",
  "function revealMove(uint256 _matchId, uint8 _move, bytes32 _salt)",
  "function getMatch(uint256 _matchId) view returns (address, address, uint256, address, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256)",
  "function matchCounter() view returns (uint256)",
  "function getRoundStatus(uint256 matchId, uint8 round, address player) view returns (bytes32 commitHash, bool revealed)",
  "function fiseMatches(uint256 matchId) view returns (bytes32)"
];

const LOGIC_REGISTRY_ABI = [
  "function registry(bytes32) view returns (string cid, address developer, uint256 totalMatches, uint256 totalVolume, bool verified)"
];

class LLMHouseBot {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private escrow: Contract;
  private registry: Contract;
  private saltManager: SaltManager;
  private genAI: GoogleGenerativeAI;
  private gameLogics: string[];
  private escrowAddress: string;
  private busy = false;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    
    const pk = process.env.HOUSE_BOT_PRIVATE_KEY;
    const escrow = process.env.ESCROW_ADDRESS;
    const registry = process.env.LOGIC_REGISTRY_ADDRESS;
    
    this.gameLogics = [
      "0xf2f80f1811f9e2c534946f0e8ddbdbd5c1e23b6e48772afe3bccdb9f2e1cfdf3"  // RockPaperScissorsJS
    ];

    this.wallet = new ethers.Wallet(pk!, this.provider);
    this.escrowAddress = escrow!.toLowerCase();
    this.escrow = new Contract(this.escrowAddress, ESCROW_ABI, this.wallet);
    this.registry = new Contract(registry!, LOGIC_REGISTRY_ABI, this.wallet);
    this.saltManager = new SaltManager();
  }

  async run() {
    logger.info({ address: this.wallet.address }, '🤖 LLM House Bot (Joshua) active');
    
    // 1. Initial Scan
    await this.refreshLogicIds();
    await this.handleMatches();

    // 2. Realtime Listeners
    logger.info('📡 Enabling LLM Joshua Realtime Watcher...');
    (supabase as any)
      .channel('joshua-llm-swarm')
      .on('postgres_changes', { event: '*', table: 'matches' }, () => this.handleMatches())
      .on('postgres_changes', { event: 'INSERT', table: 'rounds' }, () => this.handleMatches())
      .on('postgres_changes', { event: '*', table: 'logic_aliases' }, () => this.refreshLogicIds())
      .subscribe();

    // 3. Heartbeat
    while (true) {
      try {
        await new Promise(resolve => setTimeout(resolve, 60000));
        await this.refreshLogicIds();
        await this.handleMatches();
      } catch (e) {
        logger.error(e, 'LLM House Bot Heartbeat Error');
      }
    }
  }

  async refreshLogicIds() {
    try {
      const { data: aliases } = await supabase.from('logic_aliases').select('logic_id').eq('is_active', true);
      if (aliases) {
        const newLogics = aliases.map(a => a.logic_id.toLowerCase());
        const oldLogics = JSON.stringify(this.gameLogics.sort());
        if (oldLogics !== JSON.stringify(newLogics.sort())) {
          this.gameLogics = newLogics;
          logger.info({ logics: this.gameLogics }, '🔄 Game logic IDs refreshed from Supabase');
        }
      }
    } catch (err) {
      logger.warn('Failed to refresh logic IDs from Supabase');
    }
  }

  async handleMatches() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this._handleMatches();
    } finally {
      this.busy = false;
    }
  }

  private async _handleMatches() {
    const counter = await this.escrow.matchCounter();
    const matchCount = Number(counter);
    
    const openByLogic: Record<string, boolean> = {};
    const activeByLogic: Record<string, boolean> = {};

    const start = Math.max(1, matchCount - 10);
    for (let i = start; i <= matchCount; i++) {
      try {
        const match = await this.escrow.getMatch(i);
        const status = Number(match[9]);
        const playerA = match[0].toLowerCase();
        const playerB = match[1].toLowerCase();
        let logic = match[3].toLowerCase();

        if (logic === this.escrowAddress) {
          logic = (await this.escrow.fiseMatches(i)).toLowerCase();
        }

        const isPlayerA = playerA === this.wallet.address.toLowerCase();
        const isPlayerB = playerB === this.wallet.address.toLowerCase();

        if (status === 0 && isPlayerA) openByLogic[logic] = true;
        if (status === 1 && (isPlayerA || isPlayerB)) {
          activeByLogic[logic] = true;
          await this.playMatch(i, match, logic);
        }
      } catch (err) {
        logger.warn({ matchId: i }, 'Error fetching match');
      }
    }

    for (const logic of this.gameLogics) {
      if (!openByLogic[logic] && !activeByLogic[logic]) {
        await this.createLiquidity(logic);
      }
    }
  }

  async createLiquidity(logicId: string) {
    logger.info({ logicId }, '💰 Creating LLM liquidity match');
    try {
      const stake = ethers.parseEther('0.001');
      const tx = await this.escrow.createFiseMatch(stake, logicId, { value: stake });
      await tx.wait();
      logger.info({ hash: tx.hash }, '✅ Liquidity match created');
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to create liquidity');
    }
  }

  private computePokerHand(address: string, matchId: string, round: number, playerA: string): number[] {
    const seedStr = matchId + "_" + round;
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
    
    const isA = address.toLowerCase() === playerA.toLowerCase();
    const offset = isA ? 0 : 5;
    return deck.slice(offset, offset + 5);
  }

  private cardName(card: number): string {
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King', 'Ace'];
    const suits = ['Clubs', 'Diamonds', 'Hearts', 'Spades'];
    return `${ranks[card % 13]} of ${suits[Math.floor(card / 13)]}`;
  }

  async playMatch(matchId: number, matchData: any, logicId: string) {
    const round = Number(matchData[6]);
    const phase = Number(matchData[8]);
    const dbMatchId = `${this.escrowAddress}-${matchId}`;

    const [commitHash, revealed] = await this.escrow.getRoundStatus(matchId, round, this.wallet.address);

    if (phase === 0 && commitHash === ethers.ZeroHash) {
      // Check if we already have a saved salt for this round (previous commit attempt)
      const existing = await this.saltManager.getSalt(dbMatchId, round);
      if (existing) {
        logger.info({ matchId, round, move: existing.move }, '🔄 Reusing saved salt for retry');
        try {
          const hash = ethers.solidityPackedKeccak256(
            ['string', 'address', 'uint256', 'uint256', 'address', 'uint256', 'bytes32'],
            ["FALKEN_V1", this.escrowAddress, matchId, round, this.wallet.address, existing.move, existing.salt]
          );
          const tx = await this.escrow.commitMove(matchId, hash);
          await tx.wait();
          logger.info({ matchId, round }, '✅ Commit retry succeeded');
        } catch (err: any) {
          logger.error({ matchId, round, err: err.message }, '❌ Commit retry failed');
        }
        return;
      }

      // Generate salt FIRST so we can compute the poker hand
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const move = await this.getLLMMove(matchId, round, logicId, salt, matchData[0]);
      const hash = ethers.solidityPackedKeccak256(
        ['string', 'address', 'uint256', 'uint256', 'address', 'uint256', 'bytes32'],
        ["FALKEN_V1", this.escrowAddress, matchId, round, this.wallet.address, move, salt]
      );

      await this.saltManager.saveSalt({ matchId: dbMatchId, round, move, salt });
      logger.info({ matchId, round, move }, '🎲 LLM committing move');
      try {
        const tx = await this.escrow.commitMove(matchId, hash);
        await tx.wait();
        logger.info({ matchId, round }, '✅ Commit confirmed');
      } catch (err: any) {
        logger.error({ matchId, round, err: err.message }, '❌ Commit failed, will retry next poll');
      }
    } else if (phase === 1 && !revealed) {
      const entry = await this.saltManager.getSalt(dbMatchId, round);
      if (entry) {
        // Wait for provider nonce to settle after recent commits
        await new Promise(r => setTimeout(r, 2000));
        // Re-check on-chain state to avoid stale reveals
        const [, alreadyRevealed] = await this.escrow.getRoundStatus(matchId, round, this.wallet.address);
        if (alreadyRevealed) return;
        logger.info({ matchId, round, move: entry.move }, '🔓 LLM revealing move');
        try {
          const tx = await this.escrow.revealMove(matchId, entry.move, entry.salt);
          await tx.wait();
        } catch (err: any) {
          logger.error({ matchId, round, err: err.message }, '❌ Reveal failed');
        }
      }
    }
  }

  async getLLMMove(matchId: number, round: number, logicId: string, salt: string, playerA: string): Promise<number> {
    logger.info({ matchId, round }, '🧠 Querying Gemini for next move...');

    // 1. Fetch game logic source (local fallback for speed)
    let logicSource = "";
    const pokerAliases = ['0x4173a4e2e54727578fd50a3f1e721827c4c97c3a2824ca469c0ec730d4264b43', '0xec63afc7c67678adbe7a60af04d49031878d1e78eff9758b1b79edeb7546dfdf', '0x5f164061c4cbb981098161539f7f691650e0c245be54ade84ea5b57496955846'];
    const rpsAliases = ['0xf2f80f1811f9e2c534946f0e8ddbdbd5c1e23b6e48772afe3bccdb9f2e1cfdf3'];

    if (rpsAliases.includes(logicId)) {
      logicSource = fs.readFileSync(path.resolve(__dirname, '../../../games/rps.js'), 'utf8');
    } else if (pokerAliases.includes(logicId)) {
      logicSource = fs.readFileSync(path.resolve(__dirname, '../../../games/poker.js'), 'utf8');
    } else {
      logger.error({ logicId }, 'Unsupported Logic ID requested');
      return 0;
    }

    // 2. Compute poker hand if applicable
    let handContext = '';
    if (pokerAliases.includes(logicId)) {
      const dbMatchId = `${this.escrowAddress}-${matchId}`;
      const hand = this.computePokerHand(this.wallet.address, dbMatchId, round, playerA);
      const handNames = hand.map((c, i) => `  Index ${i}: ${this.cardName(c)}`);
      handContext = `
      YOUR CURRENT HAND (5 cards dealt to you this round):
${handNames.join('\n')}

      IMPORTANT DISCARD RULES:
      - Respond with "99" to keep all cards (IMPORTANT)
      - Discard at most 2 cards (3+ overflows the uint8 move encoding)
      - List indices in DESCENDING order to avoid leading zeros (e.g., "42" not "24", "30" not "03")
      - Discarded cards are replaced from the deck
      `;
      logger.info({ hand: hand.map(c => this.cardName(c)) }, '🃏 Joshua poker hand');
    }

    // 3. Fetch match history from Supabase
    const { data: history } = await supabase
      .from('rounds')
      .select('*')
      .eq('match_id', `${this.escrowAddress}-${matchId}`)
      .order('round_number', { ascending: true });

    // 4. Build the prompt
    const model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `
      You are Joshua, the Falken Protocol House Bot. You are a strategic, high-stakes player.

      GAME RULES (JavaScript):
      ${logicSource}
      ${handContext}
      MATCH STATUS:
      - Match ID: ${matchId}
      - Current Round: ${round}
      - History: ${JSON.stringify(history)}

      MOVE FORMAT RULES:
      - If RPS: 0=Rock, 1=Paper, 2=Scissors.
      - If Poker Blitz: Digits of indices to DISCARD in DESCENDING order (max 2). "99" to keep all. "42" to discard indices 4,2. "30" to discard indices 3,0.

      Analyze the rules and history. Respond ONLY with a single JSON object:
      {
        "reasoning": "your brief strategic thought",
        "move": "<string_or_integer>"
      }
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    try {
      const json = JSON.parse(text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1));
      let move = Number(json.move);
      // Clamp to uint8: if move > 255, keep only the first 2 digits (top 2 discard indices)
      if (move > 255) {
        const digits = String(json.move).split('').map(Number).sort((a, b) => b - a);
        move = Number(digits.slice(0, 2).join(''));
        logger.warn({ original: json.move, clamped: move }, '⚠️ Move exceeded uint8, clamped to 2 discards');
      }
      logger.info({ reasoning: json.reasoning, move }, '🧠 Gemini Reasoning');
      return move;
    } catch (e) {
      logger.error('Failed to parse Gemini response, defaulting to random');
      return 0;
    }
  }
}

const bot = new LLMHouseBot();
bot.run().catch(console.error);
