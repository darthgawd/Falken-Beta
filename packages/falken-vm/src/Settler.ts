import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import pino from 'pino';

const logger = (pino as any)({ name: 'falken-settler' });

// V3 ABI (Synced with FiseEscrow.sol)
const FISE_ESCROW_ABI = [
  {
    name: 'resolveFiseRound',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'roundWinnerIndex', type: 'uint8' }
    ],
    outputs: []
  }
] as const;

/**
 * Falken Settler (V3)
 * Handles the administrative transactions to resolve rounds.
 * Match settlement is now triggered internally by the contract when win conditions are met.
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
   * @param escrowAddress The FiseEscrow contract address
   * @param matchId The match ID
   * @param roundWinnerIndex 0-indexed index of the winner in the players array, or 255 for DRAW.
   * @param description Optional state description (FEN, JSON, etc) to persist in Supabase.
   */
  async resolveRound(escrowAddress: `0x${string}`, matchId: bigint, roundWinnerIndex: number, description?: string) {
    logger.info({ matchId: matchId.toString(), roundWinnerIndex, description }, 'INITIATING_ROUND_RESOLUTION');

    try {
      const nonce = await this.client.getTransactionCount({
        address: this.account.address,
        blockTag: 'pending'
      });

      const hash = await this.client.writeContract({
        address: escrowAddress,
        abi: FISE_ESCROW_ABI,
        functionName: 'resolveFiseRound',
        args: [matchId, roundWinnerIndex],
        nonce
      });

      logger.info({ hash, matchId: matchId.toString(), roundWinnerIndex }, 'ROUND_RESOLUTION_BROADCAST');
      
      const receipt = await this.client.waitForTransactionReceipt({ hash });
      logger.info({ 
        matchId: matchId.toString(), 
        status: receipt.status,
        blockNumber: receipt.blockNumber 
      }, 'ROUND_RESOLUTION_CONFIRMED');

      // Update description in Supabase (Truth Sync)
      if (description) {
        try {
          const { createClient } = await import('@supabase/supabase-js');
          const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
          const dbMatchId = `${escrowAddress.toLowerCase()}-${matchId.toString()}`;
          
          const { data: match } = await supabase.from('matches').select('current_round').eq('match_id', dbMatchId).single();
          const roundNum = match?.current_round || 1;

          await supabase.from('rounds')
            .update({ state_description: description })
            .match({ match_id: dbMatchId, round_number: roundNum });
            
          logger.info({ dbMatchId, roundNum }, 'STATE_DESCRIPTION_PERSISTED');
        } catch (dbErr: any) {
          logger.warn({ err: dbErr.message }, 'FAILED_TO_PERSIST_STATE_DESCRIPTION');
        }
      }
      
      return hash;

    } catch (err: any) {
      logger.error({ 
        err: err.message, 
        matchId: matchId.toString(),
        roundWinnerIndex 
      }, 'ROUND_RESOLUTION_FAILURE');
      throw err;
    }
  }
}
