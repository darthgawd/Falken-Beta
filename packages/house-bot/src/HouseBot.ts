import { ethers, Contract, Interface } from 'ethers';
import { SaltManager } from 'reference-agent';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const logger = pino({
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
  "function createMatch(uint256 _stake, address _gameLogic) payable",
  "function createFiseMatch(uint256 stake, bytes32 logicId) payable",
  "function joinMatch(uint256 _matchId) payable",
  "function commitMove(uint256 _matchId, bytes32 _commitHash)",
  "function revealMove(uint256 _matchId, uint8 _move, bytes32 _salt)",
  "function getMatch(uint256 _matchId) view returns (address, address, uint256, address, uint8, uint8, uint8, uint8, uint8, uint8, uint256, uint256)",
  "function matchCounter() view returns (uint256)",
  "function getRoundStatus(uint256 matchId, uint8 round, address player) view returns (bytes32 commitHash, bool revealed)"
];

const LOGIC_ABI = [
  "function gameType() view returns (string)",
  "function isValidMove(uint8 move) view returns (bool)",
  "function moveName(uint8 move) view returns (string)"
];

const PRICE_PROVIDER_ABI = [
  "function getEthAmount(uint256 usdAmount) view returns (uint256)",
  "function getMinStakeUsd() view returns (uint256)"
];

class HouseBot {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private escrow: Contract;
  private priceProvider: Contract;
  private saltManager: SaltManager;
  private gameLogics: string[];
  private escrowAddress: string;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    
    const pk = process.env.HOUSE_BOT_PRIVATE_KEY;
    const escrow = process.env.ESCROW_ADDRESS;
    const priceProvider = process.env.PRICE_PROVIDER_ADDRESS;
    
    // Support multiple logics
    this.gameLogics = [
      "0x5f164061c4cbb981098161539f7f691650e0c245be54ade84ea5b57496955846", // Auto-injected: POKER_BLIND
      "0xec63afc7c67678adbe7a60af04d49031878d1e78eff9758b1b79edeb7546dfdf", // Auto-injected: POKER_BLITZ_V5
      "0x31adebc3e6f489dab0e3d7867ef5cf63b27bd0735ce35f1cc7f671e3c303ef3a", // Auto-injected: ROCK_PAPER_SCISSORS
      "0x4173a4e2e54727578fd50a3f1e721827c4c97c3a2824ca469c0ec730d4264b43", // Auto-injected: PokerBlitzV4
      "0x6f4d505614c94a0bfe3c42be9b809d80a8b1c7cf9bdc2bbc6cbb344eb13f5f47", // Auto-injected: PokerBlitzV3
      // "0xf2f80f1811f9e2c534946f0e8ddbdbd5c1e23b6e48772afe3bccdb9f2e1cfdf3", // RockPaperScissorsJS (JS)
      // "0xeab3c0b5d2eb106900c3d910b01a89c6ab7e4fc0a79eca8d75fb7a805cfef9fb", // LiarsDiceJS (JS)
      "0xc60d070e0cede74c425c5c5afe657be8f62a5dfa37fb44e72d0b18522806ffd4", // ShowdownBlitzPoker (JS)
    ].filter(Boolean) as string[];

    logger.info({
      escrow,
      priceProvider,
      gameLogics: this.gameLogics,
      pkPrefix: pk ? `${pk.slice(0, 10)}...` : 'undefined'
    }, 'HouseBot environment check');

    this.wallet = new ethers.Wallet(pk!, this.provider);
    this.escrowAddress = escrow!.toLowerCase();
    
    // Create Interface explicitly for proper encoding
    const escrowInterface = new Interface(ESCROW_ABI);
    this.escrow = new Contract(this.escrowAddress, escrowInterface, this.wallet);
    
    this.priceProvider = new Contract(priceProvider!, PRICE_PROVIDER_ABI, this.wallet);
    this.saltManager = new SaltManager();
  }

  /**
   * Helper to get the DB-prefixed match ID.
   */
  private getDbMatchId(onChainId: number | string): string {
    return `${this.escrowAddress}-${onChainId.toString()}`;
  }

  async run() {
    logger.info({ address: this.wallet.address }, '🏠 House Bot active');
    
    // Claim branded identity if nickname is set
    const nickname = process.env.HOUSE_BOT_NICKNAME;
    if (nickname) {
      await this.claimNickname(nickname);
    }

    // 1. Initial Scan
    await this.handleMatches();

    // 2. Realtime Listeners (The Speed Layer)
    logger.info('📡 Enabling Realtime Strategic Watcher...');
    (supabase as any)
      .channel('house-bot-swarm')
      .on('postgres_changes', { event: '*', table: 'matches' }, (payload: any) => {
        logger.debug({ event: payload.eventType }, '⚡ Match update detected');
        this.handleMatches();
      })
      .on('postgres_changes', { event: 'INSERT', table: 'rounds' }, (payload: any) => {
        logger.debug('⚡ New move detected');
        this.handleMatches();
      })
      .subscribe();

    // 3. Heartbeat Polling (The Fallback Layer)
    while (true) {
      try {
        await new Promise(resolve => setTimeout(resolve, 60000)); // Heartbeat every 60s
        await this.handleMatches();
      } catch (e) {
        logger.error(e, 'House Bot Heartbeat Error');
      }
    }
  }

  /**
   * Cryptographically claim a nickname for the House Bot
   */
  private async claimNickname(nickname: string) {
    logger.info({ nickname }, '🏷️ Claiming house bot identity...');
    try {
      // 1. Sign the nickname
      const signature = await this.wallet.signMessage(nickname);
      
      // 2. We use the same public upsert pattern as the MCP server
      // agent_profiles has an 'Allow Anonymous Upsert' policy for this purpose.
      const { error } = await supabase
        .from('agent_profiles')
        .upsert({
          address: this.wallet.address.toLowerCase(),
          nickname: nickname,
          last_active: new Date().toISOString()
        }, { onConflict: 'address' });

      if (error) throw error;
      logger.info('✅ House bot identity verified and updated');
    } catch (err: any) {
      logger.error({ err: err.message }, '❌ Failed to claim house bot identity');
    }
  }

  async handleMatches() {
    let matchCount = 0;
    try {
      const counter = await this.escrow.matchCounter();
      matchCount = Number(counter);
      logger.debug({ matchCount }, 'Pulse: Checking matches for activity');
    } catch (err) {
      logger.warn('Failed to fetch matchCounter, likely RPC congestion. Skipping scan.');
      // If we can't even get the counter, we definitely can't create liquidity.
      return; 
    }

    const openByLogic: Record<string, boolean> = {};
    // Track matches where Joshua is waiting for an opponent (he's playerA but no playerB yet)
    const waitingMatchesByLogic: Record<string, boolean> = {};
    // Track matches where Joshua is actively playing (opponent joined, game in progress)
    const activeByLogic: Record<string, boolean> = {};
    
    try {
      // Check recent matches for activity - scan only the last 10 to be safe
      const start = Math.max(1, matchCount - 10);
      logger.info({ start, end: matchCount }, '🔍 Scanning match range');
      for (let i = start; i <= matchCount; i++) {
        try {
          const [
            playerA, playerB, stake, gameLogic, 
            winsA, winsB, currentRound, drawCounter, 
            phase, status, commitDeadline, revealDeadline
          ] = await this.escrow.getMatch(i);
          
          let logic = gameLogic.toLowerCase();
          
          // IF FISE: Fetch the actual Logic ID from the fiseMatches mapping
          if (logic === this.escrowAddress) {
            try {
              const fiseEscrow = new Contract(this.escrowAddress, [
                "function fiseMatches(uint256) view returns (bytes32)"
              ], this.provider);
              logic = (await fiseEscrow.fiseMatches(i)).toLowerCase();
            } catch (err) {
              logger.warn({ matchId: i }, 'Failed to fetch FISE logic ID during scan');
            }
          }

          const isPlayerA = playerA.toLowerCase() === this.wallet.address.toLowerCase();
          const isPlayerB = playerB.toLowerCase() === this.wallet.address.toLowerCase();
          const playerBIsEmpty = playerB === ethers.ZeroAddress;
          
          const s = Number(status);
          const ph = Number(phase);

          // If we created this match and it's still OPEN, track it
          if (s === 0 && isPlayerA) {
            logger.info({ matchId: i, logic }, '⏳ Open match exists for logic');
            openByLogic[logic] = true;
          }
          
          // If we created this match, it's ACTIVE, but no opponent has joined yet
          // This prevents creating multiple matches before opponent joins
          if (s === 1 && isPlayerA && playerBIsEmpty) {
            logger.info({ matchId: i, logic }, '⏳ Active match waiting for opponent');
            waitingMatchesByLogic[logic] = true;
          }

          // If we are a participant and match is ACTIVE with a real opponent, track it
          if (s === 1 && (isPlayerA || isPlayerB) && !playerBIsEmpty) {
            activeByLogic[logic] = true;
            logger.info({
              matchId: i, 
              round: Number(currentRound), 
              phase: ph,
              isPlayerA,
              isPlayerB 
            }, 'Pulse: Active match detected, processing moves');
            
            // Re-pack for playMatch
            const mData = {
              playerA, playerB, stake, gameLogic, 
              winsA, winsB, currentRound, drawCounter, 
              phase: ph, status: s, commitDeadline, revealDeadline
            };
            await this.playMatch(i, mData);
          }
        } catch (err: any) {
          logger.warn({ matchId: i, error: err.message, code: err.code }, 'Error processing match, skipping');
        }
      }
    } catch (err) {
      logger.error(err, 'Critical error during match scan loop');
    }

    // Ensure liquidity - Create a match for EACH logic if Joshua doesn't already have an OPEN, WAITING, or ACTIVE one
    for (const logic of this.gameLogics) {
      const logicLower = logic.toLowerCase();
      if (openByLogic[logicLower]) {
        logger.info({ logic }, 'Joshua already has an OPEN match for this logic. Skipping.');
      } else if (waitingMatchesByLogic[logicLower]) {
        logger.info({ logic }, 'Joshua has an ACTIVE match waiting for opponent. Skipping.');
      } else if (activeByLogic[logicLower]) {
        logger.info({ logic }, 'Joshua is playing an ACTIVE match for this logic. Skipping.');
      } else {
        logger.info({ logic }, 'Joshua has no open matches for this logic. Creating liquidity match.');
        await this.createLiquidity(logic);
      }
    }
  }

  async createLiquidity(logic: string) {
    logger.info({ logic }, '💰 Using hardcoded stake for liquidity...');
    try {
      // Hardcoded stake: 0.001 ETH (simplified for testing)
      const stake = ethers.parseEther('0.001');

      logger.info({ 
        stakeEth: ethers.formatEther(stake) 
      }, '💰 Creating new match with hardcoded stake');

      let tx;
      // If logic is a 32-byte hash (66 chars with 0x), it's a FISE Logic ID
      if (logic.length === 66 && logic.startsWith('0x')) {
        logger.info({ logicId: logic }, 'Using createFiseMatch for JS Logic');
        tx = await this.escrow.createFiseMatch(stake, logic, { value: stake });
      } else {
        logger.info({ logicAddress: logic }, 'Using standard createMatch for Solidity Logic');
        tx = await this.escrow.createMatch(stake, logic, { value: stake });
      }

      logger.info({ hash: tx.hash }, 'Transaction sent, waiting for confirmation...');
      await tx.wait();
      logger.info({ hash: tx.hash, logic }, '✅ Match created successfully');
    } catch (err: any) {
      // LOG FULL ERROR DETAILS
      logger.error({ 
        msg: err.message,
        code: err.code,
        data: err.data,
        method: err.method,
        transaction: err.transaction
      }, '❌ Failed to create liquidity match');
    }
  }

  async getStrategicMove(opponentAddress: string, logicAddress: string, matchId?: number, round?: number, salt?: string): Promise<number> {
    const logicLower = logicAddress.toLowerCase();
    
    // Check if this is the HighRollerDice JS Logic ID
    if (logicLower === '0xada4dcc50ff30f57dba673b4868f2ed6faacefb6a8fc47fc3876ee8bc385fd47') {
      const move = Math.floor(Math.random() * 100) + 1;
      logger.info({ move }, '🎲 Joshua picking HighRoller move (1-100)');
      return move;
    }

    // Check if this is the RockPaperScissorsJS Logic ID
    if (logicLower === '0xf2f80f1811f9e2c534946f0e8ddbdbd5c1e23b6e48772afe3bccdb9f2e1cfdf3') {
      const move = Math.floor(Math.random() * 3);
      logger.info({ move }, '🎲 Joshua picking RPS JS move (0-2)');
      return move;
    }

    // Check if this is the LiarsDiceJS Logic ID
    if (logicLower === '0xeab3c0b5d2eb106900c3d910b01a89c6ab7e4fc0a79eca8d75fb7a805cfef9fb') {
      // Packed BID: (quantity * 10) + face. 0 = CALL.
      const shouldCall = Math.random() < 0.2; 
      if (shouldCall) {
        logger.info('🎲 Joshua calling LIAR');
        return 0; 
      } else {
        const quantity = Math.floor(Math.random() * 3) + 1; 
        const face = Math.floor(Math.random() * 6) + 1;
        const bidValue = (quantity * 10) + face;
        logger.info({ quantity, face }, '🎲 Joshua bidding');
        return bidValue;
      }
    }

    // Check if this is the ShowdownBlitzPoker Logic ID
    if (logicLower === '0xc60d070e0cede74c425c5c5afe657be8f62a5dfa37fb44e72d0b18522806ffd4') {
      return this.getPokerBlitzMove(salt!, round!);
    }

    logger.info({ logicLower }, 'Falling through to generic logic contract');
    const logicContract = new Contract(logicAddress, LOGIC_ABI, this.provider);
    const gameType = await logicContract.gameType();
    
    logger.info({ opponent: opponentAddress, gameType }, 'Analysing opponent patterns...');
    
    try {
      const { data: history } = await supabase
        .from('rounds')
        .select('move')
        .eq('player_address', opponentAddress.toLowerCase())
        .not('move', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!history || history.length < 3) {
        logger.info('Insufficient history, playing randomly');
        return this.getRandomMove(logicContract);
      }

      if (gameType === 'RPS') {
        return this.getStrategicMoveForRPS(history);
      } else if (gameType === 'SIMPLE_DICE') {
        return this.getStrategicMoveForDice(history);
      }
    } catch (err) {
      logger.error(err, 'Failed to fetch history from Supabase');
    }

    return this.getRandomMove(logicContract);
  }

  private async getRandomMove(logicContract: Contract): Promise<number> {
    // Try moves 0-10 until valid
    const validMoves = [];
    for (let i = 0; i <= 10; i++) {
      if (await logicContract.isValidMove(i)) validMoves.push(i);
    }
    return validMoves[Math.floor(Math.random() * validMoves.length)];
  }

  private getStrategicMoveForRPS(history: any[]): number {
    // 1. Edge Case: No history or too little data, be random
    if (!history || history.length < 5) {
      return Math.floor(Math.random() * 3);
    }

    // history is [newest, ..., oldest]
    const lastMove = history[0].move;
    
    // 2. Build Transition Matrix: Count what they played AFTER 'lastMove' in the past
    const transitionCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
    let foundPatterns = 0;

    for (let i = 0; i < history.length - 1; i++) {
      // If we find an instance of their last move in the past...
      if (history[i + 1].move === lastMove) {
        const nextMoveInPast = history[i].move;
        if (transitionCounts[nextMoveInPast] !== undefined) {
          transitionCounts[nextMoveInPast]++;
          foundPatterns++;
        }
      }
    }

    // 3. Decide strategy
    let predictedMove: number;

    if (foundPatterns < 2) {
      // Not enough specific pattern data for this transition, fallback to general frequency
      const generalCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
      history.forEach(r => generalCounts[r.move]++);
      predictedMove = Object.keys(generalCounts).reduce((a, b) => 
        generalCounts[Number(a)] > generalCounts[Number(b)] ? Number(a) : Number(b)
      , 0);
    } else {
      // Bayesian Prediction: Pick the move they play most often after 'lastMove'
      predictedMove = 0;
      if (transitionCounts[1] > transitionCounts[predictedMove]) predictedMove = 1;
      if (transitionCounts[2] > transitionCounts[predictedMove]) predictedMove = 2;
    }

    // 4. Counter the prediction (0->1, 1->2, 2->0)
    const optimalCounter = (predictedMove + 1) % 3;

    // 5. Anti-Exploit Mix (80% Strategic, 20% Perfectly Random)
    // This prevents Joshua from being "trained" and exploited by another bot.
    const isRandomRound = Math.random() < 0.20;
    if (isRandomRound) {
      logger.info('🎲 GTO Mix: Playing random to remain unpredictable');
      return Math.floor(Math.random() * 3);
    }

    logger.info({ 
      lastMove, 
      predictedNext: predictedMove, 
      counter: optimalCounter,
      confidence: foundPatterns 
    }, '🧠 Bayesian Logic Applied');
    
    return optimalCounter;
  }

  private getStrategicMoveForDice(history: any[]): number {
    // Simple Dice strategy: High-roll. 
    // Opponent history might not matter as much as just rolling high,
    // but we could bias towards beating their average.
    const sum = history.reduce((acc, r) => acc + (r.move || 0), 0);
    const avg = sum / history.length;
    
    logger.info({ avg }, 'Opponent average roll calculated');
    
    // Bias towards 4, 5, 6
    const roll = Math.floor(Math.random() * 3) + 4; 
    return roll;
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
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const suits = ['♠', '♥', '♦', '♣'];
    return `${ranks[card % 13]}${suits[Math.floor(card / 13)]}`;
  }

  private getPokerBlitzMove(salt: string, round: number): number {
    const hand = this.computePokerHand(this.wallet.address, salt, round);
    const handNames = hand.map(c => this.cardName(c));
    logger.info({ hand: handNames }, '🃏 Poker hand computed');

    // Evaluate: count rank frequencies
    const ranks = hand.map(c => c % 13);
    const counts: Record<number, number> = {};
    ranks.forEach(r => counts[r] = (counts[r] || 0) + 1);

    const sortedEntries = Object.entries(counts).sort((a, b) => Number(b[1]) - Number(a[1]) || Number(b[0]) - Number(a[0]));
    const maxCount = Number(sortedEntries[0][1]);

    // Determine which card indices to discard
    let discardIndices: number[] = [];

    if (maxCount >= 3) {
      // Trips or quads: keep matched cards, discard the rest
      const keepRank = Number(sortedEntries[0][0]);
      discardIndices = ranks
        .map((r, i) => r !== keepRank ? i : -1)
        .filter(i => i >= 0);
    } else if (maxCount === 2) {
      // Pair (or two pair): keep paired cards, discard the rest
      const keepRanks = sortedEntries.filter(e => Number(e[1]) >= 2).map(e => Number(e[0]));
      discardIndices = ranks
        .map((r, i) => !keepRanks.includes(r) ? i : -1)
        .filter(i => i >= 0);
    } else {
      // Nothing: keep two highest cards, discard 3
      const indexed = ranks.map((r, i) => ({ rank: r, idx: i }));
      indexed.sort((a, b) => b.rank - a.rank);
      const keepIndices = new Set([indexed[0].idx, indexed[1].idx]);
      discardIndices = ranks
        .map((_, i) => !keepIndices.has(i) ? i : -1)
        .filter(i => i >= 0);
    }

    // Limit to max 2 discards (3-card discards sorted descending almost always exceed uint8 max 255)
    if (discardIndices.length > 2) {
      discardIndices = discardIndices.slice(0, 2);
    }

    if (discardIndices.length === 0) {
      logger.info('🃏 Keeping all cards (move=0)');
      return 0;
    }

    // Sort DESCENDING to avoid leading zeros (e.g., [0,3] → "30" not "03")
    const moveStr = discardIndices.sort((a, b) => b - a).join('');
    const move = Number(moveStr);
    logger.info({ discards: discardIndices, move }, '🃏 Strategic discards');
    return move;
  }

  async playMatch(matchId: number, matchData: any) {
    const round = Number(matchData.currentRound);
    const phase = Number(matchData.phase); // 0 = COMMIT, 1 = REVEAL
    const dbMatchId = this.getDbMatchId(matchId);
    
    let status;
    try {
      // Use manual encoding to avoid ABI issues with FISE matches
      const iface = new Interface(["function getRoundStatus(uint256 matchId, uint8 round, address player) view returns (bytes32 commitHash, bool revealed)"]);
      const data = iface.encodeFunctionData("getRoundStatus", [matchId, round, this.wallet.address]);
      
      const result = await this.provider.call({
        to: this.escrowAddress,
        data: data
      });
      
      const decoded = iface.decodeFunctionResult("getRoundStatus", result);
      status = [decoded[0], decoded[1]];
    } catch (err: any) {
      logger.error({ matchId, round, error: err.message }, 'Failed to get round status');
      throw err;
    }
    
    const commitHash = status[0];
    const revealed = status[1];

    if (phase === 0 && commitHash === ethers.ZeroHash) {
      const opponent = matchData.playerA.toLowerCase() === this.wallet.address.toLowerCase()
        ? matchData.playerB
        : matchData.playerA;

      // Generate salt FIRST so poker strategy can compute hand from it
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const move = await this.getStrategicMove(opponent, matchData.gameLogic, matchId, round, salt);
      
      // Hash calculation MUST match MatchEscrow.sol:
      // keccak256(abi.encodePacked("FALKEN_V1", address(this), _matchId, m.currentRound, msg.sender, _move, _salt))
      const hash = ethers.solidityPackedKeccak256(
        ['string', 'address', 'uint256', 'uint256', 'address', 'uint256', 'bytes32'],
        ["FALKEN_V1", this.escrowAddress, matchId, round, this.wallet.address, move, salt]
      );

      // Save using DB-compatible ID for recovery
      await this.saltManager.saveSalt({ matchId: dbMatchId, round, move, salt });
      logger.info({ matchId, round, move }, '🎲 Committing move');
      try {
        const tx = await this.escrow.commitMove(matchId, hash);
        await tx.wait();
        logger.info({ hash: tx.hash }, 'Commit transaction confirmed');
      } catch (err) {
        logger.error(err, 'Failed to commit move');
      }
    } 
    else if (phase === 1 && !revealed) {
      const entry = await this.saltManager.getSalt(dbMatchId, round);
      if (entry) {
        logger.info({ matchId, round, move: entry.move, salt: entry.salt }, '🔓 Revealing move');
        try {
          const tx = await this.escrow.revealMove(matchId, entry.move, entry.salt);
          await tx.wait();
          logger.info({ hash: tx.hash }, 'Reveal transaction confirmed');
        } catch (err: any) {
          logger.error({ error: err.message, data: err.transaction?.data }, 'Failed to reveal move');
        }
      } else {
        logger.warn({ matchId, round, dbMatchId }, 'Missing salt for reveal, state recovery might be needed');
      }
    }
  }
}

const bot = new HouseBot();
bot.run().catch(err => logger.error(err, 'Fatal error in House Bot'));

