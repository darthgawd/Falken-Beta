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
      matchId: match.match_id,
      playerA: (match.player_a || '').toLowerCase(),
      playerB: (match.player_b || '').toLowerCase(),
      stake: BigInt(match.stake_wei || '0'),
      config: match.config || {}
    };

    // 2. Fetch CURRENT round only (not historical rounds)
    // Each round is independent — using old round data causes stale results
    const currentRound = match.current_round || 1;
    const { data: rounds, error: roundsError } = await this.supabase
      .from('rounds')
      .select('*')
      .eq('match_id', matchId)
      .eq('round_number', currentRound)
      .order('player_index', { ascending: true });

    if (roundsError) {
      throw new Error(`RECONSTRUCTION_FAILED: Could not fetch rounds for ${matchId}`);
    }

    // 3. Assemble Move History
    // Note: We only include revealed moves with unmasked data.
    const moves: GameMove[] = (rounds || [])
      .filter(r => r.revealed && r.move !== null)
      .map(r => ({
        player: r.player_address,
        moveData: r.move,
        round: r.round_number,
        salt: r.salt
      }));

    logger.info({ matchId, currentRound, moveCount: moves.length }, 'RECONSTRUCTION_COMPLETE');

    return { context, moves };
  }
}
