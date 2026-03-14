import { ethers, Contract } from 'ethers';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localEnv = path.resolve(process.cwd(), '.env');
const rootEnv = path.resolve(__dirname, '../../../.env');

if (fs.existsSync(localEnv)) {
  dotenv.config({ path: localEnv });
} else {
  dotenv.config({ path: rootEnv });
}

const logger = pino({
  name: 'david-foundation',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
}, process.stderr);

const supabase: any = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// V4 PokerEngine ABI (JSON Style for Stability)
const ESCROW_ABI = [
  "function createMatch(uint256 stake, bytes32 logicId, uint8 maxPlayers, uint8 winsRequired, uint8 maxRounds, uint256 maxBuyIn, uint8 betStructure)",
  "function joinMatch(uint256 matchId)",
  "function commitMove(uint256 _matchId, bytes32 _commitHash)",
  "function revealMove(uint256 _matchId, bytes32 _move, bytes32 _salt)",
  "function raise(uint256 matchId, uint256 raiseAmount)",
  "function call(uint256 matchId)",
  "function check(uint256 matchId)",
  "function fold(uint256 matchId)",
  {
    "inputs": [{ "name": "matchId", "type": "uint256" }],
    "name": "getMatch",
    "outputs": [{
      "components": [
        { "name": "players", "type": "address[]" },
        { "name": "stake", "type": "uint256" },
        { "name": "totalPot", "type": "uint256" },
        { "name": "logicId", "type": "bytes32" },
        { "name": "maxPlayers", "type": "uint8" },
        { "name": "maxRounds", "type": "uint8" },
        { "name": "currentRound", "type": "uint8" },
        { "name": "wins", "type": "uint8[]" },
        { "name": "drawCounter", "type": "uint8" },
        { "name": "winsRequired", "type": "uint8" },
        { "name": "status", "type": "uint8" },
        { "name": "winner", "type": "address" },
        { "name": "createdAt", "type": "uint256" }
      ],
      "name": "",
      "type": "tuple"
    }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "name": "matchId", "type": "uint256" }],
    "name": "getPokerState",
    "outputs": [{
      "components": [
        { "name": "phase", "type": "uint8" },
        { "name": "betStructure", "type": "uint8" },
        { "name": "maxStreets", "type": "uint8" },
        { "name": "street", "type": "uint8" },
        { "name": "activePlayers", "type": "uint8" },
        { "name": "raiseCount", "type": "uint8" },
        { "name": "playersToAct", "type": "uint8" },
        { "name": "currentBet", "type": "uint256" },
        { "name": "maxBuyIn", "type": "uint256" },
        { "name": "commitDeadline", "type": "uint256" },
        { "name": "betDeadline", "type": "uint256" },
        { "name": "revealDeadline", "type": "uint256" },
        { "name": "folded", "type": "bool[]" },
        { "name": "streetBets", "type": "uint256[]" }
      ],
      "name": "",
      "type": "tuple"
    }],
    "stateMutability": "view",
    "type": "function"
  },
  "function getCurrentTurnIndex(uint256 matchId) view returns (uint8)",
  "function matchCounter() view returns (uint256)",
  {
    "inputs": [
      { "name": "matchId", "type": "uint256" },
      { "name": "round", "type": "uint8" },
      { "name": "player", "type": "address" }
    ],
    "name": "roundCommits",
    "outputs": [
      { "name": "commitHash", "type": "bytes32" },
      { "name": "move", "type": "bytes32" },
      { "name": "salt", "type": "bytes32" },
      { "name": "revealed", "type": "bool" }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)"
];

type BrainResponse = {
  move: number;
  reasoning: string;
  taunt: string;
  model: string;
};

class DavidFoundation {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private escrow: Contract;
  private usdc: Contract;
  private escrowAddress: string;
  private busy = false;
  private pendingActions = new Set<string>();

  // Brain Client (Gemini Only as requested)
  private gemini: GoogleGenerativeAI;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    this.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    
    const pk = process.env.AGENT_PRIVATE_KEY;
    const usdcAddr = process.env.USDC_ADDRESS;
    this.escrowAddress = ethers.getAddress(process.env.ESCROW_ADDRESS || '');
    
    this.wallet = new ethers.Wallet(pk!, this.provider);
    this.escrow = new Contract(this.escrowAddress, ESCROW_ABI, this.wallet);
    this.usdc = new Contract(usdcAddr!, ERC20_ABI, this.wallet);
  }

  async run() {
    logger.info({ address: this.wallet.address }, '🤖 David Foundation V4 Active');
    await this.ensureApproval();

    while (true) {
      try {
        await this.handleMatches();
        await new Promise(resolve => setTimeout(resolve, 15000));
      } catch (e) {
        logger.error(e, 'Foundation Heartbeat Error');
      }
    }
  }

  async ensureApproval() {
    const allowance = await this.usdc.allowance(this.wallet.address, this.escrowAddress);
    if (allowance < ethers.parseUnits("100", 6)) {
      const tx = await this.usdc.approve(this.escrowAddress, ethers.MaxUint256);
      await tx.wait();
      logger.info('✅ USDC Approved');
    }
  }

  async handleMatches() {
    if (this.busy) return;
    this.busy = true;
    try {
      const counter = await this.escrow.matchCounter();
      const matchCount = Number(counter);
      
      let pokerActive = false;
      const pokerId = "0x6de9e3cf14c5a06e9e46ade75679a7e6e49f4f9f96bd873e5166cf276ccf0233";

      for (let i = Math.max(1, matchCount - 9); i <= matchCount; i++) {
        const m = await this.escrow.getMatch(i);
        
        const match = {
          players: m.players,
          stake: m.stake,
          totalPot: m.totalPot,
          logicId: m.logicId,
          maxPlayers: m.maxPlayers,
          maxRounds: m.maxRounds,
          currentRound: m.currentRound,
          wins: m.wins,
          drawCounter: m.drawCounter,
          winsRequired: m.winsRequired,
          status: Number(m.status),
          winner: m.winner,
          createdAt: m.createdAt
        };
        
        const logic = match.logicId.toLowerCase();
        const status = match.status;

        if (logic === pokerId && (status === 0 || status === 1)) {
          pokerActive = true;
        }

        const isInMatch = match.players.some((p: string) => p.toLowerCase() === this.wallet.address.toLowerCase());
        if (status === 0 && !isInMatch) { // OPEN
          await this.joinMatch(i);
        } else if (status === 1 && isInMatch) { // ACTIVE
          await this.playRound(i, match);
        }
      }
    } catch (err: any) {
      logger.error({ err: err.message }, 'Match loop error');
    } finally {
      this.busy = false;
    }
  }

  async joinMatch(matchId: number) {
    logger.info({ matchId }, '⚔️ Joining Match');
    try {
      const tx = await this.escrow.joinMatch(matchId);
      await tx.wait();
      logger.info({ matchId }, '✅ Joined');
    } catch (err: any) {
      logger.error({ err: err.message }, 'Join failed');
    }
  }

  async playRound(matchId: number, matchData: any) {
    const round = Number(matchData.currentRound);
    const dbMatchId = `${this.escrowAddress}-${matchId}`.toLowerCase();
    
    const ps = await this.escrow.getPokerState(matchId);
    const phase = Number(ps.phase); 
    const street = Number(ps.street);
    const playerIdx = matchData.players.findIndex((p: string) => p.toLowerCase() === this.wallet.address.toLowerCase());
    
    const actionKey = `${dbMatchId}-${round}-${street}-${phase}`;
    if (this.pendingActions.has(actionKey)) return;

    const status = await this.escrow.roundCommits(matchId, round, this.wallet.address);
    const commitHash = status.commitHash;
    const revealed = status.revealed;

    if (phase === 0 && commitHash === ethers.ZeroHash) { // COMMIT
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const response = await this.queryRotatingBrain(matchId, round, matchData.logicId, playerIdx, "COMMIT");
      
      const moveBytes32 = ethers.zeroPadValue(ethers.toBeHex(response.move), 32);
      const hash = ethers.solidityPackedKeccak256(
        ['string', 'address', 'uint256', 'uint256', 'address', 'bytes32', 'bytes32'],
        ["FALKEN_V4", this.escrowAddress, matchId, round, this.wallet.address, moveBytes32, salt]
      );

      this.pendingActions.add(actionKey);

      // V4: Save Salt to Supabase Vault
      const { error: saltErr } = await supabase.from('salt_vault').insert({
        agent_address: this.wallet.address.toLowerCase(),
        match_id: dbMatchId,
        round_number: round,
        move_value: response.move.toString(),
        salt_value: salt
      });
      if (saltErr) logger.error({ err: saltErr.message }, '❌ Failed to save salt to vault');

      await this.saveReasoning(dbMatchId, round, playerIdx, response);

      logger.info({ matchId, model: response.model, reasoning: response.reasoning }, '🎲 Committing Move');
      try {
        const tx = await this.escrow.commitMove(matchId, hash, { nonce: await this.wallet.getNonce('pending') });
        await tx.wait();
      } catch (err: any) {
        logger.error({ err: err.message }, 'Commit failed');
      } finally {
        this.pendingActions.delete(actionKey);
      }
    } 
    else if (phase === 1) { // BET
      const turnIndex = await this.escrow.getCurrentTurnIndex(matchId);
      if (Number(turnIndex) !== playerIdx) return;

      const amountOwed = ps.currentBet - (ps.streetBets[playerIdx] ?? 0n);
      const response = await this.queryRotatingBrain(matchId, round, matchData.logicId, playerIdx, "BET", {
        pot: ethers.formatUnits(matchData.totalPot, 6),
        toCall: ethers.formatUnits(amountOwed, 6),
        raisesLeft: (2n - BigInt(ps.raiseCount)).toString()
      });

      this.pendingActions.add(actionKey);
      await this.saveReasoning(dbMatchId, round, playerIdx, response);

      try {
        const nonce = await this.wallet.getNonce('pending');
        if (response.move === 1 && BigInt(ps.raiseCount) < 2n) {
          logger.info({ matchId }, '🚀 Raising');
          const tx = await this.escrow.raise(matchId, matchData.stake, { nonce });
          await tx.wait();
        } else if (response.move === 2) {
          logger.info({ matchId }, '🏳️ Folding');
          const tx = await this.escrow.fold(matchId, { nonce });
          await tx.wait();
        } else {
          if (amountOwed > 0n) {
            logger.info({ matchId }, '🤙 Calling');
            const tx = await this.escrow.call(matchId, { nonce });
            await tx.wait();
          } else {
            logger.info({ matchId }, '✅ Checking');
            const tx = await this.escrow.check(matchId, { nonce });
            await tx.wait();
          }
        }
      } catch (err: any) {
        logger.error({ err: err.message }, 'Bet failed');
      } finally {
        this.pendingActions.delete(actionKey);
      }
    }
    else if (phase === 2 && !revealed) { // REVEAL
      logger.info({ matchId, round, dbMatchId }, '🔍 Fetching Salt from Supabase Vault');
      
      const { data: entry, error: fetchErr } = await supabase
        .from('salt_vault')
        .select('move_value, salt_value')
        .eq('match_id', dbMatchId)
        .eq('round_number', round)
        .eq('agent_address', this.wallet.address.toLowerCase())
        .maybeSingle();

      if (fetchErr) logger.error({ err: fetchErr.message }, 'Error fetching salt');

      if (entry) {
        this.pendingActions.add(actionKey);
        logger.info({ matchId, round }, '🔓 Revealing Move');
        try {
          const moveBytes32 = ethers.zeroPadValue(ethers.toBeHex(entry.move_value), 32);
          const tx = await this.escrow.revealMove(matchId, moveBytes32, entry.salt_value, { nonce: await this.wallet.getNonce('pending') });
          await tx.wait();
        } catch (err: any) {
          logger.error({ err: err.message }, 'Reveal failed');
        } finally {
          this.pendingActions.delete(actionKey);
        }
      } else {
        logger.warn({ dbMatchId, round }, '❌ SALT NOT FOUND IN SUPABASE VAULT!');
      }
    }
  }

  async saveReasoning(dbMatchId: string, round: number, playerIdx: number, response: BrainResponse) {
    await supabase.from('rounds').upsert({
      match_id: dbMatchId,
      round_number: round,
      player_address: this.wallet.address.toLowerCase(),
      player_index: playerIdx,
      reasoning: response.reasoning,
      state_description: response.taunt
    }, { onConflict: 'match_id,round_number,player_address' });
  }

  async queryRotatingBrain(matchId: number, round: number, logicId: string, playerIdx: number, phase: string, wagerData?: any): Promise<BrainResponse> {
    const prompt = `You are David, a competitive AI agent. Phase: ${phase}
    ${this.getGameContext(matchId, round, logicId, playerIdx)}
    ${phase === "BET" ? `\nWAGER PHASE: Total Pot: $${wagerData.pot}. To Call: $${wagerData.toCall}. Raises Left: ${wagerData.raisesLeft}. DECISION RULES: move 0=CHECK/CALL, 1=RAISE, 2=FOLD.` : ""}
    Respond ONLY with valid JSON: { "move": number, "reasoning": "strategy", "taunt": "short trash talk" }`;

    try {
      const model = this.gemini.getGenerativeModel({ model: "gemini-2.5-flash" });
      const result = await model.generateContent(prompt);
      const text = result.response.text();

      const startIdx = text.indexOf('{');
      const endIdx = text.lastIndexOf('}') + 1;
      const json = JSON.parse(text.substring(startIdx, endIdx));
      
      return { ...json, model: 'gemini-2.5-flash' };
    } catch (err) {
      logger.error({ err }, 'Brain failed');
    }
    return { move: 0, reasoning: "Safety fallback", taunt: "...", model: 'fallback' };
  }

  private getGameContext(matchId: number, round: number, logicId: string, playerIdx: number): string {
    const pokerId = '0x6de9e3cf14c5a06e9e46ade75679a7e6e49f4f9f96bd873e5166cf276ccf0233';
    const dbMatchId = `${this.escrowAddress.toLowerCase()}-${matchId}`;
    if (logicId.toLowerCase() === pokerId) {
      const hand = this.computeHand(dbMatchId, round, playerIdx);
      const handNames = hand.map((c, i) => `${this.cardName(c)}`).join(', ');
      
      logger.info({ matchId, round, hand: handNames }, '🎴 DAVID HAND');
      
      return `GAME: Poker Blitz (5-Card Draw). HAND: ${handNames}
      RULES: Discard via bitmask (0-31). 0=STAY.`;
    }
    return "Generic Game. Move 0.";
  }

  private computeHand(matchId: string, round: number, playerIndex: number): number[] {
    const seedStr = (matchId + "_" + round).toLowerCase();
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);
    const deck = Array.from({length: 52}, (_, i) => i);
    for (let i = deck.length - 1; i > 0; i--) {
      hash = (Math.imul(1664525, hash) + 1013904223) | 0;
      const j = Math.abs(hash % (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const offset = playerIndex * 5;
    return deck.slice(offset, offset + 5);
  }

  private cardName(card: number): string {
    const ranks = ['2','3','4','5','6','7','8','9','10','Jack','Queen','King','Ace'];
    const suits = ['Clubs','Diamonds','Hearts','Spades'];
    return `${ranks[card % 13]} of ${suits[Math.floor(card / 13)]}`;
  }
}

const bot = new DavidFoundation();
bot.run().catch(console.error);
