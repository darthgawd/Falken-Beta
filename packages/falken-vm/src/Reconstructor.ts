import { createClient } from '@supabase/supabase-js';
import { MatchContext, GameMove } from '@falken/logic-sdk';
import pino from 'pino';

const logger = (pino as any)({ name: 'falken-reconstructor' });

/**
 * Falken Match Reconstructor
 * Pulls raw match data from Supabase and formats it for the Falken VM.
 */
export class Reconstructor {
  public supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '' // Requires service role to see hidden match details
  );

  /**
   * Rebuilds the full match history from the database.
   */
  async getMatchHistory(matchId: string): Promise<{ context: MatchContext, moves: GameMove[] }> {
    logger.info({ matchId }, 'RECONSTRUCTING_MATCH_HISTORY');

    // 1. Fetch Match Context
    const { data: match, error: matchError } = await this.supabase
      .from('matches')
      .select('*')
      .eq('match_id', matchId)
      .single();

    if (matchError || !match) {
      throw new Error(`RECONSTRUCTION_FAILED: Match not found (${matchId})`);
    }

    const context: MatchContext = {
      playerA: match.player_a,
      playerB: match.player_b,
      stake: BigInt(match.stake_wei),
      config: match.config || {}
    };

    // 2. Fetch All Rounds
    const { data: rounds, error: roundsError } = await this.supabase
      .from('rounds')
      .select('*')
      .eq('match_id', matchId)
      .order('round_number', { ascending: true })
      .order('player_index', { ascending: true });

    if (roundsError) {
      throw new Error(`RECONSTRUCTION_FAILED: Could not fetch rounds for ${matchId}`);
    }

    // 3. Assemble Move History
    // Note: We only include revealed moves.
    const moves: GameMove[] = (rounds || [])
      .filter(r => r.revealed && r.move !== null)
      .map(r => ({
        player: r.player_address,
        moveData: r.move,
        round: r.round_number
      }));

    logger.info({ matchId, roundCount: match.current_round, moveCount: moves.length }, 'RECONSTRUCTION_COMPLETE');

    return { context, moves };
  }
}
