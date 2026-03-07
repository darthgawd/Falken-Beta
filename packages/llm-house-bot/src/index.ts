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
}, process.stderr);

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// V3 ABI (Standard JSON for complex tuples)
const ESCROW_ABI = [
  "function createMatch(uint256 stake, bytes32 logicId, uint8 maxPlayers)",
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
  "function balanceOf(address account) view returns (uint256)"
];

class LLMHouseBot {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private escrow: Contract;
  private usdc: Contract;
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
    const usdcAddr = process.env.USDC_ADDRESS;
    
    // Default V3 Logic IDs
    this.gameLogics = [
      "0x9f803373e9b7dc5edddcb91c5ca2d000c78360e0d53c5d17ee9d0b6037c6358b"  // Poker Blitz V3 (Final)
    ];

    this.wallet = new ethers.Wallet(pk!, this.provider);
    this.escrowAddress = escrow!.toLowerCase();
    this.escrow = new Contract(this.escrowAddress, ESCROW_ABI, this.wallet);
    this.usdc = new Contract(usdcAddr!, ERC20_ABI, this.wallet);
    this.saltManager = new SaltManager();
  }

  async run() {
    logger.info({ address: this.wallet.address }, '🤖 LLM Joshua V3 active');
    
    // Auto-approve USDC for the arena
    await this.ensureApproval();

    // 1. Initial Scan
    await this.refreshLogicIds();
    await this.handleMatches();

    // 2. Realtime Watcher
    logger.info('📡 Enabling LLM Joshua Realtime Watcher...');
    (supabase as any)
      .channel('joshua-llm-v3')
      .on('postgres_changes', { event: '*', table: 'matches' }, () => this.handleMatches())
      .on('postgres_changes', { event: 'INSERT', table: 'rounds' }, () => this.handleMatches())
      .subscribe();

    while (true) {
      try {
        await new Promise(resolve => setTimeout(resolve, 30000));
        await this.handleMatches();
      } catch (e) {
        logger.error(e, 'Joshua Heartbeat Error');
      }
    }
  }

  async ensureApproval() {
    try {
      logger.info('Checking USDC approval...');
      const tx = await this.usdc.approve(this.escrowAddress, ethers.MaxUint256);
      await tx.wait();
      logger.info('✅ USDC approved for Escrow');
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to approve USDC');
    }
  }

  async refreshLogicIds() {
    try {
      const { data: aliases } = await supabase.from('logic_aliases').select('logic_id').eq('is_active', true);
      if (aliases) {
        this.gameLogics = aliases.map(a => a.logic_id.toLowerCase());
        logger.info({ logics: this.gameLogics }, '🔄 V3 Logic IDs refreshed');
      }
    } catch (err) {
      logger.warn('Failed to refresh logic IDs');
    }
  }

  async withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T | null> {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (err: any) {
        if (i === retries - 1) {
          logger.error({ err: err.message }, 'RPC call failed after retries');
          return null;
        }
        await new Promise(r => setTimeout(r, delay * (i + 1)));
      }
    }
    return null;
  }

  async handleMatches() {
    if (this.busy) return;
    this.busy = true;
    try {
      const counter = await this.withRetry(() => this.escrow.matchCounter());
      if (!counter) return;
      const matchCount = Number(counter);
      
      const openByLogic: Record<string, boolean> = {};
      const activeByLogic: Record<string, boolean> = {};

      const start = Math.max(1, matchCount - 5);
      for (let i = start; i <= matchCount; i++) {
        try {
          const m = await this.withRetry(() => this.escrow.getMatch(i));
          if (!m) continue;
          
          // Handle both struct decoding formats (array vs object)
          const match = Array.isArray(m) ? {
            players: m[0],
            stake: m[1],
            totalPot: m[2],
            logicId: m[3],
            maxPlayers: m[4],
            currentRound: m[5],
            wins: m[6],
            drawCounter: m[7],
            winsRequired: m[8],
            phase: m[9],
            status: m[10],
            commitDeadline: m[11],
            revealDeadline: m[12],
            winner: m[13]
          } : {
            players: m.players,
            stake: m.stake,
            totalPot: m.totalPot,
            logicId: m.logicId,
            maxPlayers: m.maxPlayers,
            currentRound: m.currentRound,
            wins: m.wins,
            drawCounter: m.drawCounter,
            winsRequired: m.winsRequired,
            phase: m.phase,
            status: m.status,
            commitDeadline: m.commitDeadline,
            revealDeadline: m.revealDeadline,
            winner: m.winner
          };

          const status = Number(match.status);
          const players = match.players.map((p: string) => p.toLowerCase());
          const logic = match.logicId.toLowerCase();

          const isInMatch = players.includes(this.wallet.address.toLowerCase());

          if (status === 0) { // OPEN
            if (isInMatch) openByLogic[logic] = true;
            else await this.joinAvailableMatch(i, match.stake);
          } else if (status === 1 && isInMatch) { // ACTIVE
            activeByLogic[logic] = true;
            await this.playMatch(i, match, logic);
          }
        } catch (err: any) {
          logger.warn({ matchId: i, error: err.message }, 'Error fetching match state');
        }
      }

      // Maintain liquidity for Poker (DISABLED for current test)
      /*
      const pokerId = "0xa00a45cb44b39c3dc91fb7963d2dd65c217ae5b25c20cb216c1f9431900a5d61";
      if (!openByLogic[pokerId] && !activeByLogic[pokerId]) {
        await this.createLiquidity(pokerId);
      }
      */

    } finally {
      this.busy = false;
    }
  }

  async joinAvailableMatch(matchId: number, stake: bigint) {
    logger.info({ matchId, stake: ethers.formatUnits(stake, 6) }, '⚔️ Joshua joining match');
    try {
      const tx = await this.escrow.joinMatch(matchId);
      await tx.wait();
      logger.info({ matchId }, '✅ Joined successfully');
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to join match');
    }
  }

  async createLiquidity(logicId: string) {
    logger.info({ logicId }, '💰 Joshua creating liquidity match');
    try {
      const stake = ethers.parseUnits('1.00', 6); // 1 USDC
      const tx = await this.escrow.createMatch(stake, logicId, 2);
      await tx.wait();
      logger.info({ hash: tx.hash }, '✅ Liquidity match created');
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to create liquidity');
    }
  }

  private computePokerHand(matchId: string, round: number, playerIndex: number): number[] {
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
    const offset = playerIndex * 5;
    return deck.slice(offset, offset + 5);
  }

  private cardName(card: number): string {
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King', 'Ace'];
    const suits = ['Clubs', 'Diamonds', 'Hearts', 'Spades'];
    return `${ranks[card % 13]} of ${suits[Math.floor(card / 13)]}`;
  }

  async playMatch(matchId: number, matchData: any, logicId: string) {
    const status = Number(matchData.status);
    if (status !== 1) return; // Only play if ACTIVE

    const round = Number(matchData.currentRound);
    const phase = Number(matchData.phase); 
    const dbMatchId = `${this.escrowAddress}-${matchId}`;

    let commitHash = ethers.ZeroHash;
    let revealed = false;

    try {
      const roundStatus = await this.escrow.getRoundStatus(matchId, round, this.wallet.address);
      commitHash = roundStatus[0];
      revealed = roundStatus[2]; // revealed is at index 2 in getRoundStatus return
    } catch (err: any) {
      logger.warn({ matchId, round, err: err.message }, 'Failed to fetch round status, skipping this tick');
      return;
    }

    if (phase === 0 && commitHash === ethers.ZeroHash) {
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const playerIndex = matchData.players.findIndex((p: string) => p.toLowerCase() === this.wallet.address.toLowerCase());
      
      const move = await this.getLLMMove(matchId, round, logicId, salt, playerIndex);
      
      const hash = ethers.solidityPackedKeccak256(
        ['string', 'address', 'uint256', 'uint256', 'address', 'uint256', 'bytes32'],
        ["FALKEN_V1", this.escrowAddress, matchId, round, this.wallet.address, move, salt]
      );

      await this.saltManager.saveSalt({ matchId: dbMatchId, round, move, salt });
      logger.info({ matchId, round, move }, '🎲 Committing move');
      try {
        const tx = await this.escrow.commitMove(matchId, hash);
        await tx.wait();
      } catch (err: any) {
        logger.error({ err: err.message }, 'Commit failed');
      }
    } else if (phase === 1 && !revealed) {
      const entry = await this.saltManager.getSalt(dbMatchId, round);
      if (entry) {
        logger.info({ matchId, round }, '🔓 Revealing move');
        try {
          const tx = await this.escrow.revealMove(matchId, entry.move, entry.salt);
          await tx.wait();
        } catch (err: any) {
          logger.error({ err: err.message }, 'Reveal failed');
        }
      }
    }
  }

  async getLLMMove(matchId: number, round: number, logicId: string, salt: string, playerIndex: number): Promise<number> {
    logger.info({ matchId, round }, '🧠 Joshua querying Gemini...');

    // 1. Fetch game logic source
    const pokerId = '0xa00a45cb44b39c3dc91fb7963d2dd65c217ae5b25c20cb216c1f9431900a5d61';
    let handContext = '';
    
    if (logicId.toLowerCase() === pokerId) {
      const hand = this.computePokerHand(matchId.toString(), round, playerIndex);
      const handNames = hand.map((c, i) => `  Index ${i}: ${this.cardName(c)}`);
      
      // Log the dealt hand BEFORE querying Gemini
      logger.info({ matchId, round, hand: handNames }, '🃏 Hand Dealt');
      
      handContext = `
      YOUR CURRENT HAND:
      ${handNames.join('\n')}

      MOVE RULES:
      - "99" to KEEP ALL cards.
      - String of indices to DISCARD in DESCENDING order (max 2). e.g. "42", "30".
      `;
    }

    const model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `
      You are Joshua, the Falken Protocol House Bot. 
      You are playing a strategic match. 
      
      ${handContext}
      Match ID: ${matchId} | Round: ${round}

      Respond ONLY with a JSON object:
      { "reasoning": "thought", "move": "<number>" }
    `;

    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const rawText = response.text();
      logger.debug({ rawText }, '🧠 Gemini raw response');
      
      const json = JSON.parse(rawText.substring(rawText.indexOf('{'), rawText.lastIndexOf('}') + 1));
      const move = Number(json.move);
      logger.info({ matchId, round, reasoning: json.reasoning, move }, '🧠 Strategic Decision');
      return move;
    } catch (e: any) {
      logger.error({ error: e.message, prompt }, '🧠 Gemini failed, defaulting to STAY (99)');
      return 99; // Default to stay
    }
  }
}

const bot = new LLMHouseBot();
bot.run().catch(console.error);
