import { ethers, Contract } from 'ethers';
import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { SaltManager } from 'reference-agent';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'node:crypto';
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
  name: 'joshua-foundation',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
}, process.stderr);

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const ESCROW_ABI = [
  "function createMatch(uint256 stake, bytes32 logicId, uint8 maxPlayers, uint8 winsRequired)",
  "function joinMatch(uint256 matchId)",
  "function commitMove(uint256 _matchId, bytes32 _commitHash)",
  "function revealMove(uint256 _matchId, uint8 _move, bytes32 _salt)",
  {
    name: 'getMatch',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [{
      name: '',
      type: 'tuple',
      components: [
        { name: 'players', type: 'address[]' },
        { name: 'stake', type: 'uint256' },
        { name: 'totalPot', type: 'uint256' },
        { name: 'logicId', type: 'bytes32' },
        { name: 'maxPlayers', type: 'uint8' },
        { name: 'currentRound', type: 'uint8' },
        { name: 'wins', type: 'uint8[]' },
        { name: 'drawCounter', type: 'uint8' },
        { name: 'winsRequired', type: 'uint8' },
        { name: 'phase', type: 'uint8' },
        { name: 'status', type: 'uint8' },
        { name: 'commitDeadline', type: 'uint256' },
        { name: 'revealDeadline', type: 'uint256' },
        { name: 'winner', type: 'address' }
      ]
    }]
  },
  "function matchCounter() view returns (uint256)",
  "function getRoundStatus(uint256 matchId, uint8 round, address player) view returns (bytes32 commitHash, bytes32 salt, bool revealed)"
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

class JoshuaFoundation {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private escrow: Contract;
  private usdc: Contract;
  private saltManager: SaltManager;
  private escrowAddress: string;
  private busy = false;

  // Multi-Brain Clients
  private gemini: GoogleGenerativeAI;
  private anthropic: Anthropic | null = null;
  private kimi: OpenAI | null = null;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    this.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    
    if (process.env.CLAUDE_API_KEY) {
      this.anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    }
    if (process.env.KIMI_API_KEY) {
      this.kimi = new OpenAI({ apiKey: process.env.KIMI_API_KEY, baseURL: "https://api.moonshot.cn/v1" });
    }

    const pk = process.env.HOUSE_BOT_PRIVATE_KEY;
    const usdcAddr = process.env.USDC_ADDRESS;
    this.escrowAddress = ethers.getAddress(process.env.ESCROW_ADDRESS || '');
    
    this.wallet = new ethers.Wallet(pk!, this.provider);
    this.escrow = new Contract(this.escrowAddress, ESCROW_ABI, this.wallet);
    this.usdc = new Contract(usdcAddr!, ERC20_ABI, this.wallet);
    this.saltManager = new SaltManager();
  }

  async run() {
    logger.info({ address: this.wallet.address }, '🤖 Joshua Foundation Active (Brain Rotation Enabled)');
    await this.ensureApproval();

    // Loop
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
      const pokerId = "0x941e596b0c66e32eb8186fe5c43b990e128b0469bb9fe233512c2ad8a7b254c5";

      // Check last 10 matches for better visibility
      for (let i = Math.max(1, matchCount - 9); i <= matchCount; i++) {
        const m = await this.escrow.getMatch(i);
        const match = Array.isArray(m) ? { status: m[10], phase: m[9], players: m[0], currentRound: m[5], logicId: m[3] } : m;
        
        const logic = match.logicId.toLowerCase();
        const status = Number(match.status);

        // If a poker match is OPEN or ACTIVE, we don't need to create one
        if (logic === pokerId && (status === 0 || status === 1)) {
          pokerActive = true;
          logger.info({ matchId: i, status }, '📍 Found existing Poker match');
        }

        const isInMatch = match.players.some((p: string) => p.toLowerCase() === this.wallet.address.toLowerCase());
        if (status === 0 && !isInMatch) { // OPEN
          await this.joinMatch(i);
        } else if (status === 1 && isInMatch) { // ACTIVE
          await this.playRound(i, match);
        }
      }

      if (!pokerActive) {
        logger.info('empty arena detected, creating new match...');
        await this.createLiquidity(pokerId);
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
      logger.info({ hash: tx.hash }, 'Waiting for join confirmation...');
      await tx.wait();
      logger.info({ matchId }, '✅ Joined');
    } catch (err: any) {
      if (err.message.includes('already known')) {
        logger.warn('Join transaction already in mempool, waiting...');
      } else {
        logger.error({ err: err.message }, 'Join failed');
      }
    }
  }

  async createLiquidity(logicId: string) {
    logger.info({ logicId }, '💰 Creating Liquidity Match');
    try {
      const stake = ethers.parseUnits('0.10', 6); // 0.10 USDC
      const tx = await this.escrow.createMatch(stake, logicId, 2, 3);
      await tx.wait();
      logger.info({ hash: tx.hash }, '✅ Match Created');
    } catch (err: any) {
      logger.error({ err: err.message }, 'Create failed');
    }
  }

  async playRound(matchId: number, matchData: any) {
    const round = Number(matchData.currentRound);
    const phase = Number(matchData.phase);
    const dbMatchId = `${this.escrowAddress}-${matchId}`;

    const status = await this.escrow.getRoundStatus(matchId, round, this.wallet.address);
    const commitHash = status[0];
    const revealed = status[2];

    if (phase === 0 && commitHash === ethers.ZeroHash) { // COMMIT
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const playerIdx = matchData.players.findIndex((p: string) => p.toLowerCase() === this.wallet.address.toLowerCase());
      
      // THE BRAIN ROTATION
      const response = await this.queryRotatingBrain(matchId, round, matchData.logicId, playerIdx);
      
      const hash = ethers.solidityPackedKeccak256(
        ['string', 'address', 'uint256', 'uint256', 'address', 'uint256', 'bytes32'],
        ["FALKEN_V1", this.escrowAddress, matchId, round, this.wallet.address, response.move, salt]
      );

      await this.saltManager.saveSalt({ matchId: dbMatchId, round, move: response.move, salt });
      
      // Save reasoning and taunt to DB
      const { error: dbErr } = await supabase.from('rounds').upsert({
        match_id: dbMatchId,
        round_number: round,
        player_address: this.wallet.address.toLowerCase(),
        reasoning: response.reasoning,
        state_description: response.taunt
      }, { onConflict: 'match_id,round_number,player_address' });

      if (dbErr) {
        logger.error({ err: dbErr.message, matchId: dbMatchId }, '❌ Failed to save reasoning to DB');
      } else {
        logger.info({ matchId: dbMatchId }, '✅ Reasoning/Taunt saved to DB');
      }

      logger.info({ 
        matchId, 
        model: response.model, 
        reasoning: response.reasoning, 
        taunt: response.taunt 
      }, '🎲 Committing Move');
      const tx = await this.escrow.commitMove(matchId, hash);
      await tx.wait();
    } 
    else if (phase === 1 && !revealed) { // REVEAL
      const entry = await this.saltManager.getSalt(dbMatchId, round);
      if (entry) {
        logger.info({ matchId, round }, '🔓 Revealing Move');
        const tx = await this.escrow.revealMove(matchId, entry.move, entry.salt);
        await tx.wait();
      }
    }
  }

  async queryRotatingBrain(matchId: number, round: number, logicId: string, playerIdx: number): Promise<BrainResponse> {
    const brains = ['gemini'];
    if (this.anthropic) brains.push('claude');

    const activeBrain = brains[Math.floor(Math.random() * brains.length)];
    const context = this.getGameContext(matchId, round, logicId, playerIdx);
    
    // FETCH OPPONENT INTEL
    const players = await this.escrow.getMatch(matchId).then((m: any) => Array.isArray(m) ? m[0] : m.players);
    const opponent = players.find((p: string) => p.toLowerCase() !== this.wallet.address.toLowerCase());
    const intel = await this.getOpponentIntel(opponent);

    const prompt = `You are Joshua, a competitive AI agent. 
    
    ${context}
    
    OPPONENT BEHAVIOR (Last 10 Rounds):
    ${intel}

    Respond ONLY with a valid JSON object. No other text. Example: { "move": 0, "reasoning": "...", "taunt": "..." }`;

    try {
      let text = '';
      if (activeBrain === 'gemini') {
        const model = this.gemini.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(prompt);
        text = result.response.text();
      } 
      else if (activeBrain === 'claude' && this.anthropic) {
        const msg = await this.anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }]
        });
        text = (msg.content[0] as any).text;
      }

      // Ultra-robust JSON extraction
      let jsonStr = '';
      const startIdx = text.indexOf('{');
      if (startIdx !== -1) {
        let depth = 0;
        for (let i = startIdx; i < text.length; i++) {
          if (text[i] === '{') depth++;
          if (text[i] === '}') depth--;
          if (depth === 0) {
            jsonStr = text.substring(startIdx, i + 1);
            break;
          }
        }
      }

      if (!jsonStr) throw new Error('Could not extract balanced JSON object');
      const json = JSON.parse(jsonStr);
      
      return { 
        move: Number(json.move), 
        reasoning: json.reasoning || "Strategy logic not provided", 
        taunt: json.taunt || "...", 
        model: activeBrain === 'gemini' ? 'gemini-2.5-flash' : 'claude-sonnet-4-6'
      };
    } catch (err: any) {
      logger.error({ brain: activeBrain, err: err.message }, 'Brain failed, fallback');
    }

    return { move: 0, reasoning: "Fallback to safety", taunt: "...", model: 'fallback' };
  }

  private async getOpponentIntel(address: string): Promise<string> {
    try {
      const { data: history } = await supabase
        .from('rounds')
        .select('move')
        .eq('player_address', address.toLowerCase())
        .not('move', 'is', null)
        .order('created_at', { ascending: false })
        .limit(10);

      if (!history || history.length === 0) return "No history available for this opponent.";

      const moves = history.map(h => {
        const m = Number(h.move);
        if (m === 0 || m === 99) return "Stayed (0 cards discarded)";
        let count = 0;
        for (let i = 0; i < 5; i++) if (m & (1 << i)) count++;
        return `Discarded ${count} cards`;
      });

      return `Opponent's recent moves:\n- ${moves.join('\n- ')}`;
    } catch (err) {
      return "Error fetching opponent intel.";
    }
  }

  private getGameContext(matchId: number, round: number, logicId: string, playerIdx: number): string {
    const pokerId = '0x941e596b0c66e32eb8186fe5c43b990e128b0469bb9fe233512c2ad8a7b254c5';
    
    if (logicId.toLowerCase() === pokerId) {
      // FIXED: Use numerical matchId only (not dbMatchId) to match poker.js seed format
      // poker.js uses: state.matchId + "_" + move.round
      // where state.matchId is onChainMatchId.toString() from the VM
      const hand = this.computeHand(matchId.toString(), round, playerIdx);
      const handNames = hand.map((c, i) => `Index ${i}: ${this.cardName(c)}`);
      
      // LOG HAND BEFORE BRAIN QUERY
      logger.info({ matchId, round, hand: handNames }, '🃏 Hand Dealt');
      
      return `GAME: Poker Blitz (5-Card Draw). YOUR CURRENT HAND:\n${handNames.join('\n')}\nRULES: Discard via bitmask (0-31). 0=STAY. Respond ONLY with JSON.`;
    }
    return "Generic Game. Move 0.";
  }

  private computeHand(matchId: string, round: number, playerIndex: number): number[] {
    // FIXED: Match poker.js exactly - uses numerical matchId + "_" + round (case-sensitive)
    // poker.js: this.generateDeck(state.matchId + "_" + move.round)
    // where state.matchId comes from VM as onChainMatchId.toString()
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
    // poker.js dealing: Player A gets deck[0-4], Player B gets deck[5-9]
    const offset = playerIndex * 5;
    return deck.slice(offset, offset + 5);
  }

  private cardName(card: number): string {
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King', 'Ace'];
    const suits = ['Clubs', 'Diamonds', 'Hearts', 'Spades'];
    return `${ranks[card % 13]} of ${suits[Math.floor(card / 13)]}`;
  }
}

const bot = new JoshuaFoundation();
bot.run().catch(console.error);
