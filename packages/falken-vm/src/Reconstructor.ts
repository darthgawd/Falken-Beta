import { createClient } from '@supabase/supabase-js';
import { MatchContext, GameMove } from '@falken/logic-sdk';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { baseSepolia } from 'viem/chains';
import pino from 'pino';

const logger = (pino as any)({ name: 'falken-reconstructor' });

const MOVE_REVEALED_EVENT = parseAbiItem('event MoveRevealed(uint256 indexed matchId, uint8 round, address indexed player, bytes32 move)');

/**
 * Falken Match Reconstructor
 * V4: Pulls raw move data directly from the blockchain as the source of truth,
 * using Supabase only for match configuration context.
 */
export class Reconstructor {
  public supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );
  
  public client = createPublicClient({ 
    chain: baseSepolia, 
    transport: http(process.env.RPC_URL) 
  });

  /**
   * Rebuilds the full match history from the database and blockchain.
   */
  async getMatchHistory(dbMatchId: string, escrowAddress?: `0x${string}`, onChainMatchId?: bigint): Promise<{ context: MatchContext, moves: GameMove[] }> {
    logger.info({ matchId: dbMatchId }, 'RECONSTRUCTING_MATCH_HISTORY');

    // 1. Fetch Match Context from DB
    const { data: match, error: matchError } = await this.supabase
      .from('matches')
      .select('*')
      .eq('match_id', dbMatchId)
      .single();

    if (matchError || !match) {
      throw new Error(`RECONSTRUCTION_FAILED: Match not found (${dbMatchId})`);
    }

    const currentRound = match.current_round || 1;
    const context: MatchContext = {
      matchId: match.match_id,
      players: (match.players || []).map((p: string) => p.toLowerCase()),
      stake: match.stake_wei || '0',
      round: currentRound,
      config: match.config || {}
    };

    let moves: GameMove[] = [];

    // 2. Fetch Moves directly from Blockchain (V4 Primary Source of Truth)
    if (escrowAddress && onChainMatchId !== undefined) {
        try {
            logger.info({ escrowAddress, onChainMatchId, currentRound }, 'Fetching moves from chain...');
            const logs = await this.client.getLogs({
                address: escrowAddress,
                event: MOVE_REVEALED_EVENT,
                args: { matchId: onChainMatchId },
                fromBlock: 'earliest', // Ideally we'd narrow this to the match creation block for speed
                toBlock: 'latest'
            });

            // Filter for current round and format as GameMove
            moves = logs
                .filter(l => Number(l.args.round) === currentRound)
                .map(l => ({
                    player: l.args.player!.toLowerCase(),
                    moveData: l.args.move!, // bytes32 hex string
                    round: Number(l.args.round)
                }));
            
            logger.info({ count: moves.length }, 'Chain fetch successful');
        } catch (err: any) {
            logger.warn({ err: err.message }, 'Chain fetch failed, falling back to DB');
        }
    }

    // 3. Fallback to DB if chain fetch failed or was not requested
    if (moves.length === 0) {
        let { data: rounds, error: roundsError } = await this.supabase
        .from('rounds')
        .select('*')
        .eq('match_id', dbMatchId)
        .eq('round_number', currentRound)
        .order('player_index', { ascending: true });
        
        if (rounds && rounds.some(r => r.player_index === null)) {
            rounds = rounds.sort((a, b) => (a.player_address || '').localeCompare(b.player_address || ''));
        }

        if (roundsError) {
            throw new Error(`RECONSTRUCTION_FAILED: Could not fetch rounds for ${dbMatchId}`);
        }

        moves = (rounds || [])
        .filter(r => r.revealed && (r.move_bytes32 !== null || r.move !== null))
        .map(r => ({
            player: r.player_address,
            moveData: r.move_bytes32 || r.move, // Support V4 bytes32 and V3 numeric
            round: r.round_number,
            salt: r.salt
        }));
    }

    logger.info({ matchId: dbMatchId, currentRound, moveCount: moves.length }, 'RECONSTRUCTION_COMPLETE');

    return { context, moves };
  }
}
