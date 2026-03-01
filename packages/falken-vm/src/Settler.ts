import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import pino from 'pino';

const logger = (pino as any)({ name: 'falken-settler' });

const FISE_ESCROW_ABI = [
  { 
    name: 'settleFiseMatch', 
    type: 'function', 
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'winner', type: 'address' }
    ],
    outputs: [] 
  },
  {
    name: 'resolveFiseRound',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'roundWinner', type: 'uint8' }
    ],
    outputs: []
  }
] as const;

/**
 * Falken Settler
 * Handles the administrative transactions to resolve rounds and settle matches.
 * 
 * Multi-Round Support:
 * - resolveRound(): Called after each round to update scores and advance rounds
 * - settle(): Called for final settlement (or legacy single-round matches)
 */
export class Settler {
  private account = privateKeyToAccount((process.env.REFEREE_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001') as `0x${string}`);
  
  private client = createWalletClient({
    account: this.account,
    chain: baseSepolia,
    transport: http(process.env.RPC_URL)
  }).extend(publicActions);

  /**
   * Resolves a single FISE round.
   * Updates wins/draws on-chain, advances round if needed, auto-settles if first-to-3 reached.
   * 
   * @param escrowAddress The FiseEscrow contract address
   * @param matchId The match ID
   * @param roundWinner 0=draw, 1=playerA wins, 2=playerB wins
   */
  async resolveRound(escrowAddress: `0x${string}`, matchId: bigint, roundWinner: number) {
    logger.info({ matchId: matchId.toString(), roundWinner }, 'INITIATING_ROUND_RESOLUTION');

    try {
      const nonce = await this.client.getTransactionCount({
        address: this.account.address,
        blockTag: 'pending'
      });

      const hash = await this.client.writeContract({
        address: escrowAddress,
        abi: FISE_ESCROW_ABI,
        functionName: 'resolveFiseRound',
        args: [matchId, roundWinner as 0 | 1 | 2],
        nonce
      });

      logger.info({ hash, matchId: matchId.toString(), roundWinner }, 'ROUND_RESOLUTION_BROADCAST');
      
      // Wait for confirmation
      const receipt = await this.client.waitForTransactionReceipt({ hash });
      logger.info({ 
        matchId: matchId.toString(), 
        roundWinner,
        status: receipt.status,
        blockNumber: receipt.blockNumber 
      }, 'ROUND_RESOLUTION_CONFIRMED');
      
      return hash;

    } catch (err: any) {
      logger.error({ 
        err: err.message, 
        matchId: matchId.toString(),
        roundWinner 
      }, 'ROUND_RESOLUTION_FAILURE');
      throw err;
    }
  }

  /**
   * Settles a FISE match (legacy single-round or early settlement).
   * @param escrowAddress The FiseEscrow contract address
   * @param matchId The match ID
   * @param winner Winner address, or null for draw
   */
  async settle(escrowAddress: `0x${string}`, matchId: bigint, winner: `0x${string}` | null) {
    logger.info({ matchId: matchId.toString(), winner }, 'INITIATING_ONCHAIN_SETTLEMENT');

    try {
      const winnerAddress = winner || '0x0000000000000000000000000000000000000000';
      
      const nonce = await this.client.getTransactionCount({
        address: this.account.address,
        blockTag: 'pending'
      });

      const hash = await this.client.writeContract({
        address: escrowAddress,
        abi: FISE_ESCROW_ABI,
        functionName: 'settleFiseMatch',
        args: [matchId, winnerAddress as `0x${string}`],
        nonce
      });

      logger.info({ hash }, 'SETTLEMENT_TRANSACTION_BROADCAST');
      
      // Wait for confirmation
      const receipt = await this.client.waitForTransactionReceipt({ hash });
      logger.info({ matchId: matchId.toString(), status: receipt.status }, 'SETTLEMENT_CONFIRMED');
      
      return hash;

    } catch (err: any) {
      logger.error({ err: err.message, matchId: matchId.toString() }, 'SETTLEMENT_FAILURE');
      throw err;
    }
  }
}
