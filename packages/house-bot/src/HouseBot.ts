import { ethers, Contract } from 'ethers';
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
  "function joinMatch(uint256 _matchId) payable",
  "function commitMove(uint256 _matchId, bytes32 _commitHash)",
  "function revealMove(uint256 _matchId, uint8 _move, bytes32 _salt)",
  "function getMatch(uint256 _matchId) view returns (tuple(address playerA, address playerB, uint256 stake, address gameLogic, uint8 winsA, uint8 winsB, uint8 currentRound, uint8 phase, uint8 status, uint256 commitDeadline, uint256 revealDeadline))",
  "function matchCounter() view returns (uint256)",
  "function getRoundStatus(uint256 _matchId, uint8 _round, address _player) view returns (bytes32 commitHash, bool revealed)"
];

const LOGIC_ABI = [
  "function gameType() view returns (string)",
  "function isValidMove(uint8 move) view returns (bool)",
  "function moveName(uint8 move) view returns (string)"
];

class HouseBot {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private escrow: Contract;
  private saltManager: SaltManager;
  private gameLogics: string[];
  private escrowAddress: string;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    
    const pk = process.env.HOUSE_BOT_PRIVATE_KEY;
    const escrow = process.env.ESCROW_ADDRESS;
    
    // Support multiple logic addresses from env
    this.gameLogics = [
      process.env.RPS_LOGIC_ADDRESS!,
      process.env.DICE_LOGIC_ADDRESS
    ].filter(Boolean) as string[];

    logger.info({
      escrow,
      gameLogics: this.gameLogics,
      pkPrefix: pk ? `${pk.slice(0, 10)}...` : 'undefined'
    }, 'HouseBot environment check');

    this.wallet = new ethers.Wallet(pk!, this.provider);
    this.escrowAddress = escrow!.toLowerCase();
    this.escrow = new Contract(this.escrowAddress, ESCROW_ABI, this.wallet);
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

    while (true) {
      try {
        await this.handleMatches();
        await new Promise(resolve => setTimeout(resolve, 15000)); // Poll every 15s
      } catch (e) {
        logger.error(e, 'House Bot Error');
        await new Promise(resolve => setTimeout(resolve, 5000));
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
    const counter = await this.escrow.matchCounter();
    const matchCount = Number(counter);
    logger.debug({ matchCount }, 'Pulse: Checking matches for activity');

    const openByLogic: Record<string, boolean> = {};
    
    // Check recent matches for activity
    for (let i = Math.max(1, matchCount - 50); i <= matchCount; i++) {
      const m = await this.escrow.getMatch(i);
      const status = Number(m.status);
      const logic = m.gameLogic.toLowerCase();
      
      // If we created this match and it's still OPEN, track it
      if (status === 0 && m.playerA.toLowerCase() === this.wallet.address.toLowerCase()) {
        logger.info({ matchId: i, logic }, '⏳ Open match exists for logic');
        openByLogic[logic] = true;
      }

      // If we are a participant and match is ACTIVE, handle moves
      if (status === 1 && (m.playerA.toLowerCase() === this.wallet.address.toLowerCase() || m.playerB.toLowerCase() === this.wallet.address.toLowerCase())) {
        logger.info({ matchId: i, round: Number(m.currentRound), phase: Number(m.phase) }, 'Pulse: Active match detected, processing moves');
        await this.playMatch(i, m);
      }
    }

    // Ensure liquidity - ONLY ONE OPEN MATCH GLOBALLY for now
    const anyOpen = Object.values(openByLogic).some(v => v === true);
    if (!anyOpen) {
      // Pick first logic as default
      await this.createLiquidity(this.gameLogics[0]);
    }
  }

  async createLiquidity(logic: string) {
    logger.info({ logic }, '💰 Creating new match for liquidity...');
    const stakeStr = process.env.HOUSE_BOT_STAKE_ETH || "0.001";
    const stake = ethers.parseEther(stakeStr);
    
    try {
      const tx = await this.escrow.createMatch(stake, logic, { value: stake });
      await tx.wait();
      logger.info({ hash: tx.hash, logic }, '✅ Match created');
    } catch (err) {
      logger.error({ err: (err as any).message, logic }, 'Failed to create liquidity match');
    }
  }

  async getStrategicMove(opponentAddress: string, logicAddress: string): Promise<number> {
    const logicContract = new Contract(logicAddress, LOGIC_ABI, this.provider);
    const gameType = await logicContract.gameType();
    
    logger.info({ opponent: opponentAddress, gameType }, 'Analysing opponent patterns...');
    
    const { data: history } = await supabase
      .from('rounds')
      .select('move')
      .eq('player_address', opponentAddress.toLowerCase())
      .not('move', 'is', null)
      .order('created_at', { ascending: false }) // Note: check-match-onchain uses round_number, but created_at is safer for sequence
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
    const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
    history.forEach(r => {
      if (r.move !== null && counts[r.move] !== undefined) counts[r.move]++;
    });

    let mostFrequent = 0;
    if (counts[1] > counts[mostFrequent]) mostFrequent = 1;
    if (counts[2] > counts[mostFrequent]) mostFrequent = 2;

    return (mostFrequent + 1) % 3;
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

  async playMatch(matchId: number, matchData: any) {
    const round = Number(matchData.currentRound);
    const phase = Number(matchData.phase); // 0 = COMMIT, 1 = REVEAL
    const dbMatchId = this.getDbMatchId(matchId);

    const status = await this.escrow.getRoundStatus(matchId, round, this.wallet.address);
    const commitHash = status[0];
    const revealed = status[1];

    if (phase === 0 && commitHash === ethers.ZeroHash) {
      const opponent = matchData.playerA.toLowerCase() === this.wallet.address.toLowerCase() 
        ? matchData.playerB 
        : matchData.playerA;

      const move = await this.getStrategicMove(opponent, matchData.gameLogic);
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const hash = ethers.solidityPackedKeccak256(
        ['uint256', 'uint8', 'address', 'uint8', 'bytes32'],
        [matchId, round, this.wallet.address, move, salt]
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
        logger.info({ matchId, round }, '🔓 Revealing move');
        try {
          const tx = await this.escrow.revealMove(matchId, entry.move, entry.salt);
          await tx.wait();
          logger.info({ hash: tx.hash }, 'Reveal transaction confirmed');
        } catch (err) {
          logger.error(err, 'Failed to reveal move');
        }
      } else {
        logger.warn({ matchId, round }, 'Missing salt for reveal, state recovery might be needed');
      }
    }
  }
}

const bot = new HouseBot();
bot.run().catch(err => logger.error(err, 'Fatal error in House Bot'));

