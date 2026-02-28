import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import pino from 'pino';

const logger = (pino as any)({ name: 'falken-settler' });

const FISE_ESCROW_ABI = [
  { 
    name: 'settleFiseMatch', 
    type: 'function', 
    stateMutability: 'nonReentrant',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'winner', type: 'address' }
    ],
    outputs: [] 
  }
] as const;

/**
 * Falken Settler
 * Handles the administrative transaction to release ETH to the winner.
 */
export class Settler {
  private account = privateKeyToAccount((process.env.REFEREE_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001') as `0x${string}`);
  
  private client = createWalletClient({
    account: this.account,
    chain: baseSepolia,
    transport: http(process.env.RPC_URL)
  }).extend(publicActions);

  async settle(escrowAddress: `0x${string}`, matchId: bigint, winner: `0x${string}` | null) {
    logger.info({ matchId: matchId.toString(), winner }, 'INITIATING_ONCHAIN_SETTLEMENT');

    try {
      const winnerAddress = winner || '0x0000000000000000000000000000000000000000';
      
      const hash = await this.client.writeContract({
        address: escrowAddress,
        abi: FISE_ESCROW_ABI,
        functionName: 'settleFiseMatch',
        args: [matchId, winnerAddress as `0x${string}`]
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
