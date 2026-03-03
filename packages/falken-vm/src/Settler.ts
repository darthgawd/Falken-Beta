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
  async resolveRound(escrowAddress: `0x${string}`, matchId: bigint, roundWinner: number, description?: string) {
    logger.info({ matchId: matchId.toString(), roundWinner, description }, 'INITIATING_ROUND_RESOLUTION');

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

      // Update description in Supabase (Truth Sync)
      if (description) {
        try {
          const { createClient } = await import('@supabase/supabase-js');
          const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
          const dbMatchId = `${escrowAddress.toLowerCase()}-${matchId.toString()}`;
          
          // Fetch current round from contract or use local knowledge
          // We'll update the description for this specific match+round
          // The indexer might not have processed the RoundResolved event yet,
          // so we update the description for the current round entry.
          
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
