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
  name: 'scripted-liars-bot',
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

const LIARS_DICE_ID = "0x2376a7b3448a3b64858d5fcfeca172b49521df5ce706244b0300fdfe653fa28f";

class LiarsDiceBot {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private escrow: Contract;
  private saltManager: SaltManager;
  private escrowAddress: string;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL, undefined, {
      staticNetwork: ethers.Network.from(84532)
    });
    const pk = process.env.HOUSE_BOT_PRIVATE_KEY;
    const escrow = process.env.ESCROW_ADDRESS;
    this.wallet = new ethers.Wallet(pk!, this.provider);
    this.escrowAddress = escrow!.toLowerCase();
    this.escrow = new Contract(this.escrowAddress, ESCROW_ABI, this.wallet);
    this.saltManager = new SaltManager();
  }

  generateDice(salt: string): number[] {
    const seed = this.wallet.address.toLowerCase() + salt.toLowerCase();
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = ((hash << 5) - hash) + seed.charCodeAt(i);
      hash |= 0;
    }
    const dice = [];
    for (let i = 0; i < 5; i++) {
      hash = (Math.imul(1664525, hash) + 1013904223) | 0;
      dice.push(Math.abs(hash % 6) + 1);
    }
    return dice;
  }

  async run() {
    logger.info({ address: this.wallet.address }, '🎲 Scripted Liars Dice Bot active');
    while (true) {
      try {
        await this.handleMatches();
        await new Promise(resolve => setTimeout(resolve, 30000));
      } catch (e) {
        logger.error(e, 'Bot Error');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }

  async handleMatches() {
    const matchCount = Number(await this.escrow.matchCounter());
    let openMatchFound = false;
    let activeMatchFound = false;

    const start = Math.max(1, matchCount - 5);
    for (let i = start; i <= matchCount; i++) {
      try {
        const match = await this.escrow.getMatch(i);
        const status = Number(match[9]);
        const playerA = match[0].toLowerCase();
        let logic = match[3].toLowerCase();
        if (logic === this.escrowAddress) {
          logic = (await this.escrow.fiseMatches(i)).toLowerCase();
        }

        if (logic !== LIARS_DICE_ID) continue;

        if (status === 0 && playerA === this.wallet.address.toLowerCase()) openMatchFound = true;
        if (status === 1) {
          activeMatchFound = true;
          await this.playMatch(i, match);
        }
      } catch (e) {}
    }

    if (!openMatchFound && !activeMatchFound) {
      logger.info('Creating new Liars Dice match');
      const stake = ethers.parseEther('0.001');
      const tx = await this.escrow.createFiseMatch(stake, LIARS_DICE_ID, { value: stake });
      await tx.wait();
    }
  }

  async playMatch(matchId: number, matchData: any) {
    const round = Number(matchData[6]);
    const phase = Number(matchData[8]);
    const [commitHash, revealed] = await this.escrow.getRoundStatus(matchId, round, this.wallet.address);

    if (phase === 0 && commitHash === ethers.ZeroHash) {
      // SCRIPTED STRATEGY: Simple incremental bidding
      const { data: bids } = await supabase.from('rounds').select('move').eq('match_id', `${this.escrowAddress}-${matchId}`).not('move', 'is', null).order('created_at', { ascending: false });
      
      let move = Math.floor(Math.random() * 3) + 11; // Start with 11, 12, or 13
      if (bids && bids.length > 0) {
        const lastMove = Number(bids[0].move);
        if (lastMove >= 66) move = 0; // Call liar if bid is too high
        else move = lastMove + 1; // Just increment
      }

      const salt = ethers.hexlify(ethers.randomBytes(32));
      const hash = ethers.solidityPackedKeccak256(
        ['string', 'address', 'uint256', 'uint256', 'address', 'uint256', 'bytes32'],
        ["FALKEN_V1", this.escrowAddress, matchId, round, this.wallet.address, move, salt]
      );

      await this.saltManager.saveSalt({ matchId: `${this.escrowAddress}-${matchId}`, round, move, salt });
      logger.info({ move }, '🎲 Committing bid');
      try {
        const tx = await this.escrow.commitMove(matchId, hash);
        await tx.wait(1); // Wait for 1 confirmation
        logger.info({ hash: tx.hash }, '✅ Commit confirmed');
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Commit failed or timed out');
      }
    } else if (phase === 1 && !revealed) {
      const entry = await this.saltManager.getSalt(`${this.escrowAddress}-${matchId}`, round);
      if (entry) {
        logger.info({ move: entry.move }, '🔓 Revealing bid');
        try {
          const tx = await this.escrow.revealMove(matchId, entry.move, entry.salt);
          await tx.wait(1);
          logger.info({ hash: tx.hash }, '✅ Reveal confirmed');
        } catch (err: any) {
          logger.warn({ err: err.message }, 'Reveal failed or timed out');
        }
      }
    }
  }
}

new LiarsDiceBot().run();
