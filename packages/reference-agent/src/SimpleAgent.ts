import { ethers, Contract } from 'ethers';
import { SaltManager } from './SaltManager.js';
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

const ESCROW_ABI = [
  "function joinMatch(uint256 _matchId) payable",
  "function commitMove(uint256 _matchId, bytes32 _commitHash)",
  "function revealMove(uint256 _matchId, uint8 _move, bytes32 _salt)",
  "function getMatch(uint256 _matchId) view returns (tuple(address playerA, address playerB, uint256 stake, address gameLogic, uint8 winsA, uint8 winsB, uint8 currentRound, uint8 phase, uint8 status, uint256 commitDeadline, uint256 revealDeadline))",
  "function matchCounter() view returns (uint256)",
  "function getRoundStatus(uint256 _matchId, uint8 _round, address _player) view returns (bytes32 commitHash, bool revealed)"
];

/**
 * A simple reference agent that can join games and play RPS.
 * Developers can extend this to add LLM-based strategy.
 */
export class SimpleAgent {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private escrow: Contract;
  private saltManager: SaltManager;
  private escrowAddress: string;

  constructor(privateKey: string) {
    this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.escrowAddress = process.env.ESCROW_ADDRESS!.toLowerCase();
    this.escrow = new Contract(this.escrowAddress, ESCROW_ABI, this.wallet);
    this.saltManager = new SaltManager();
  }

  async run() {
    logger.info({ address: this.wallet.address }, '🤖 Agent active');
    
    while (true) {
      try {
        await this.handleMatches();
        await new Promise(resolve => setTimeout(resolve, 10000)); // Poll every 10s
      } catch (e) {
        logger.error(e, 'Agent Loop Error');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  async handleMatches() {
    const counter = await this.escrow.matchCounter();
    const matchCount = Number(counter);

    for (let i = Math.max(1, matchCount - 20); i <= matchCount; i++) {
      const m = await this.escrow.getMatch(i);
      const status = Number(m.status);

      // 1. Discovery: If match is OPEN and we aren't Player A, join it
      if (status === 0 && m.playerA.toLowerCase() !== this.wallet.address.toLowerCase()) {
        await this.joinMatch(i, m.stake);
        continue;
      }

      // 2. Gameplay: If match is ACTIVE and we are a participant, play the round
      if (status === 1 && (m.playerA.toLowerCase() === this.wallet.address.toLowerCase() || m.playerB.toLowerCase() === this.wallet.address.toLowerCase())) {
        await this.playRound(i, m);
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
      // Pick move (Strategy goes here!)
      const move = Math.floor(Math.random() * 3); 
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const hash = ethers.solidityPackedKeccak256(
        ['uint256', 'uint8', 'address', 'uint8', 'bytes32'],
        [matchId, round, this.wallet.address, move, salt]
      );

      await this.saltManager.saveSalt({ matchId: dbMatchId, round, move, salt });
      logger.info({ matchId, round, move }, '🎲 Committing move');
      const tx = await this.escrow.commitMove(matchId, hash);
      await tx.wait();
    } 
    else if (phase === 1 && !revealed) {
      const entry = await this.saltManager.getSalt(dbMatchId, round);
      if (entry) {
        logger.info({ matchId, round }, '🔓 Revealing move');
        const tx = await this.escrow.revealMove(matchId, entry.move, entry.salt);
        await tx.wait();
      }
    }
  }
}
