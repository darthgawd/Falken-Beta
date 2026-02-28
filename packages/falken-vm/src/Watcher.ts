import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { Referee } from './Referee.js';
import { Reconstructor } from './Reconstructor.js';
import { Settler } from './Settler.js';
import { Fetcher } from './Fetcher.js';
import pino from 'pino';

const logger = (pino as any)({ name: 'falken-watcher' });

const FISE_ESCROW_ABI = [
  { 
    name: 'MoveRevealed', 
    type: 'event', 
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'roundNumber', type: 'uint8' },
      { name: 'player', type: 'address', indexed: true },
      { name: 'move', type: 'uint8' }
    ] 
  }
] as const;

const LOGIC_REGISTRY_ABI = [
  { 
    name: 'registry', 
    type: 'function', 
    stateMutability: 'view', 
    inputs: [{ name: '', type: 'bytes32' }], 
    outputs: [
      { name: 'ipfsCID', type: 'string' },
      { name: 'developer', type: 'address' },
      { name: 'isVerified', type: 'bool' },
      { name: 'createdAt', type: 'uint256' },
      { name: 'totalVolume', type: 'uint256' }
    ] 
  }
] as const;

export class Watcher {
  private client = createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.RPC_URL)
  });

  private referee = new Referee();
  private reconstructor = new Reconstructor();
  private settler = new Settler();
  private fetcher = new Fetcher();

  async start(escrowAddress: `0x${string}`, registryAddress: `0x${string}`) {
    logger.info({ escrowAddress, registryAddress }, 'WATCHER_INITIALIZED // MONITORING_ARENA');

    // 1. SUPABASE FALLBACK (For Simulation/Local Test)
    const supabase = (this.reconstructor as any).supabase;
    supabase
      .channel('fise-watcher')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, async (payload: any) => {
        const match = payload.new;
        if (!match.match_id.startsWith('test-fise')) return;
        if (match.phase !== 'REVEAL' || match.status !== 'ACTIVE') return;
        
        logger.info({ dbId: match.match_id }, 'SIMULATED_REVEAL_DETECTED // INITIATING_OFFCHAIN_JUDGMENT');
        await this.processMatch(match.match_id, escrowAddress, registryAddress);
      })
      .subscribe();

    // 2. REAL BLOCKCHAIN WATCHER
    this.client.watchContractEvent({
      address: escrowAddress,
      abi: FISE_ESCROW_ABI,
      eventName: 'MoveRevealed',
      onLogs: async (logs) => {
        for (const log of logs) {
          const { matchId } = log.args;
          if (!matchId) continue;
          const dbId = `${escrowAddress.toLowerCase()}-${matchId.toString()}`;
          await this.processMatch(dbId, escrowAddress, registryAddress);
        }
      }
    });
  }

  /**
   * Retry fetching match data from Supabase, waiting for both the match
   * and at least 2 revealed moves (indexer dual-reveal gate may lag).
   */
  private async waitForCompleteMatchData(dbMatchId: string, maxRetries = 8, delayMs = 3000) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await this.reconstructor.getMatchHistory(dbMatchId);
        if (result.moves.length >= 2) {
          return result; // Both moves available
        }
        // Match found but moves incomplete — indexer may still be unmasking
        if (attempt < maxRetries - 1) {
          logger.info({ dbMatchId, moveCount: result.moves.length, attempt: attempt + 1 }, 'WAITING_FOR_MOVES_UNMASK');
          await new Promise(r => setTimeout(r, delayMs));
          continue;
        }
        return result; // Return whatever we have on final attempt
      } catch (err: any) {
        if (attempt < maxRetries - 1 && err.message?.includes('Match not found')) {
          logger.warn({ dbMatchId, attempt: attempt + 1 }, 'WAITING_FOR_INDEXER_SYNC');
          await new Promise(r => setTimeout(r, delayMs));
          continue;
        }
        throw err;
      }
    }
    throw new Error(`RECONSTRUCTION_FAILED: Match not found after ${maxRetries} retries (${dbMatchId})`);
  }

  private async processMatch(dbMatchId: string, escrowAddress: `0x${string}`, registryAddress: `0x${string}`) {
    try {
      // Wait for indexer to sync data and unmask both moves
      const { context, moves } = await this.waitForCompleteMatchData(dbMatchId);

      // Skip if moves are still incomplete after all retries
      if (moves.length < 2) {
        logger.info({ dbMatchId, moveCount: moves.length }, 'INCOMPLETE_MOVES // WAITING_FOR_OPPONENT');
        return;
      }
      
      // For simulation, we hardcode the CID if the logicRegistry lookup fails
      let jsCode = '';
      try {
        const logicId = await this.client.readContract({
          address: escrowAddress,
          abi: [{ name: 'fiseMatches', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bytes32' }] }] as const,
          functionName: 'fiseMatches',
          args: [BigInt(dbMatchId.split('-').pop() || '0')]
        });
        const [ipfsCID] = await this.client.readContract({
          address: registryAddress,
          abi: LOGIC_REGISTRY_ABI,
          functionName: 'registry',
          args: [logicId as `0x${string}`]
        });
        jsCode = await this.fetcher.fetchLogic(ipfsCID);
      } catch (err) {
        logger.warn('REGISTRY_LOOKUP_FAILED // USING_SIMULATION_LOGIC');
        jsCode = `class RockPaperScissors { 
          init(ctx) { return { score: 0, playerA: ctx.playerA, playerB: ctx.playerB, rounds: {} }; }
          processMove(state, move) {
            if (!state.rounds[move.round]) state.rounds[move.round] = {};
            if (move.player === state.playerA) state.rounds[move.round].a = move.moveData;
            else state.rounds[move.round].b = move.moveData;
            const r = state.rounds[move.round];
            if (r.a !== undefined && r.b !== undefined) {
              if (r.a === 1 && r.b === 3) state.score += 1;
              else if (r.a === 3 && r.b === 1) state.score -= 1;
            }
            return state;
          }
          checkResult(state) {
            if (state.score >= 1) return 1;
            if (state.score <= -1) return 2;
            return 0;
          }
        }`;
      }

      const winner = await this.referee.resolveMatch(jsCode, context, moves);
      logger.info({ dbMatchId, winner }, 'JUDGMENT_RENDERED');

      if (dbMatchId.startsWith('test-fise')) {
        // SIMULATION SETTLEMENT (Direct DB Update)
        const { error } = await this.reconstructor.supabase
          .from('matches')
          .update({
            status: 'SETTLED',
            winner: winner,
            phase: 'COMPLETE'
          })
          .eq('match_id', dbMatchId);

        if (error) logger.error({ dbMatchId, error }, 'SIMULATION_DB_UPDATE_FAILED');
        else logger.info({ dbMatchId }, 'SIMULATION_SETTLED_IN_DB');
      } else {
        // REAL ON-CHAIN SETTLEMENT (winner address or null for draw)
        const onChainMatchId = BigInt(dbMatchId.split('-').pop() || '0');
        await this.settler.settle(escrowAddress, onChainMatchId, (winner || '0x0000000000000000000000000000000000000000') as `0x${string}`);
      }
    } catch (err: any) {
      logger.error({ dbMatchId, err: err.message }, 'VM_PROCESSING_FAULT');
    }
  }
}
