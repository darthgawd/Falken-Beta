import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import pino from 'pino';
import { RoundResolution } from './Referee.js';

const logger = (pino as any)({ name: 'falken-settler-v4' });

// V4 PokerEngine ABI
const POKER_ENGINE_ABI = [
  {
    name: 'resolveRound',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'roundWinnerIdx', type: 'uint8' }
    ],
    outputs: []
  },
  {
    name: 'resolveRoundSplit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      {
        name: 'res', type: 'tuple', components: [
          { name: 'winnerIndices', type: 'uint8[]' },
          { name: 'splitBps', type: 'uint256[]' }
        ]
      }
    ],
    outputs: []
  },
  {
    name: 'advanceStreet',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: []
  }
] as const;

/**
 * Falken Settler (V4)
 * Handles the administrative transactions to resolve rounds.
 * Supports multi-street poker with three settlement paths:
 * 1. advanceStreet() - Not final street, continue to next
 * 2. resolveRound() - Final street, single winner
 * 3. resolveRoundSplit() - Final street, split pot
 */
export class Settler {
  private account = privateKeyToAccount((process.env.REFEREE_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001') as `0x${string}`);

  private client = createWalletClient({
    account: this.account,
    chain: baseSepolia,
    transport: http(process.env.RPC_URL)
  }).extend(publicActions);

  /**
   * Main settlement entry point with routing logic.
   * Determines which settlement method to call based on street and resolution.
   */
  async settle(
    escrowAddress: `0x${string}`,
    matchId: bigint,
    resolution: RoundResolution,
    street: number,
    maxStreets: number,
    description?: string
  ): Promise<`0x${string}`> {
    const isFinalStreet = street + 1 >= maxStreets;

    if (!isFinalStreet) {
      // Not the final street - advance to next street
      return this.advanceStreet(escrowAddress, matchId);
    }

    if (resolution.splitResult) {
      // Final street with split pot
      return this.resolveRoundSplit(
        escrowAddress,
        matchId,
        resolution.splitResult.winnerIndices,
        resolution.splitResult.splitBps,
        description
      );
    }

    // Final street with single winner (or draw)
    return this.resolveRound(escrowAddress, matchId, resolution.winner ?? 255, description);
  }

  /**
   * Resolves a single round with one winner (or draw).
   * Use for: Final street, single winner or draw.
   * @param escrowAddress The PokerEngine contract address
   * @param matchId The match ID
   * @param roundWinnerIdx 0-indexed index of winner, or 255 for draw
   * @param description Optional state description to persist
   */
  async resolveRound(
    escrowAddress: `0x${string}`,
    matchId: bigint,
    roundWinnerIdx: number,
    description?: string
  ): Promise<`0x${string}`> {
    logger.info({ matchId: matchId.toString(), roundWinnerIdx, description }, 'INITIATING_SINGLE_RESOLUTION');

    try {
      const nonce = await this.client.getTransactionCount({
        address: this.account.address,
        blockTag: 'pending'
      });

      const hash = await this.client.writeContract({
        address: escrowAddress,
        abi: POKER_ENGINE_ABI,
        functionName: 'resolveRound',
        args: [matchId, roundWinnerIdx],
        nonce
      });

      logger.info({ hash, matchId: matchId.toString(), roundWinnerIdx }, 'SINGLE_RESOLUTION_BROADCAST');

      const receipt = await this.client.waitForTransactionReceipt({ hash });
      logger.info({
        matchId: matchId.toString(),
        status: receipt.status,
        blockNumber: receipt.blockNumber
      }, 'SINGLE_RESOLUTION_CONFIRMED');

      if (description) {
        await this.persistDescription(escrowAddress, matchId, description);
      }

      return hash;
    } catch (err: any) {
      logger.error({
        err: err.message,
        matchId: matchId.toString(),
        roundWinnerIdx
      }, 'SINGLE_RESOLUTION_FAILURE');
      throw err;
    }
  }

  /**
   * Resolves a round with split pot (multiple winners).
   * Use for: Final street, pot split between 2+ winners (e.g., Omaha Hi-Lo).
   * @param escrowAddress The PokerEngine contract address
   * @param matchId The match ID
   * @param winnerIndices Array of winner indices
   * @param splitBps Array of split percentages (basis points, sum to 10000)
   * @param description Optional state description
   */
  async resolveRoundSplit(
    escrowAddress: `0x${string}`,
    matchId: bigint,
    winnerIndices: number[],
    splitBps: number[],
    description?: string
  ): Promise<`0x${string}`> {
    logger.info({ matchId: matchId.toString(), winnerIndices, splitBps, description }, 'INITIATING_SPLIT_RESOLUTION');

    try {
      const nonce = await this.client.getTransactionCount({
        address: this.account.address,
        blockTag: 'pending'
      });

      // Build resolution struct
      const resolution = {
        winnerIndices,
        splitBps: splitBps.map(b => BigInt(b))
      };

      const hash = await this.client.writeContract({
        address: escrowAddress,
        abi: POKER_ENGINE_ABI,
        functionName: 'resolveRoundSplit',
        args: [matchId, resolution],
        nonce
      });

      logger.info({ hash, matchId: matchId.toString(), winnerIndices, splitBps }, 'SPLIT_RESOLUTION_BROADCAST');

      const receipt = await this.client.waitForTransactionReceipt({ hash });
      logger.info({
        matchId: matchId.toString(),
        status: receipt.status,
        blockNumber: receipt.blockNumber
      }, 'SPLIT_RESOLUTION_CONFIRMED');

      if (description) {
        await this.persistDescription(escrowAddress, matchId, description);
      }

      return hash;
    } catch (err: any) {
      logger.error({
        err: err.message,
        matchId: matchId.toString(),
        winnerIndices,
        splitBps
      }, 'SPLIT_RESOLUTION_FAILURE');
      throw err;
    }
  }

  /**
   * Advances to the next street (betting round).
   * Use for: Not the final street - continue to next street for more betting.
   * @param escrowAddress The PokerEngine contract address
   * @param matchId The match ID
   */
  async advanceStreet(escrowAddress: `0x${string}`, matchId: bigint): Promise<`0x${string}`> {
    logger.info({ matchId: matchId.toString() }, 'INITIATING_STREET_ADVANCE');

    try {
      const nonce = await this.client.getTransactionCount({
        address: this.account.address,
        blockTag: 'pending'
      });

      const hash = await this.client.writeContract({
        address: escrowAddress,
        abi: POKER_ENGINE_ABI,
        functionName: 'advanceStreet',
        args: [matchId],
        nonce
      });

      logger.info({ hash, matchId: matchId.toString() }, 'STREET_ADVANCE_BROADCAST');

      const receipt = await this.client.waitForTransactionReceipt({ hash });
      logger.info({
        matchId: matchId.toString(),
        status: receipt.status,
        blockNumber: receipt.blockNumber
      }, 'STREET_ADVANCE_CONFIRMED');

      return hash;
    } catch (err: any) {
      logger.error({
        err: err.message,
        matchId: matchId.toString()
      }, 'STREET_ADVANCE_FAILURE');
      throw err;
    }
  }

  /**
   * Persists state description to Supabase.
   */
  private async persistDescription(escrowAddress: `0x${string}`, matchId: bigint, description: string) {
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
}
