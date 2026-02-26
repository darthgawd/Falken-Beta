import { createPublicClient, http, parseEventLogs } from 'viem';
import { baseSepolia } from 'viem/chains';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

const supabase: any = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const publicClient: any = createPublicClient({ chain: baseSepolia, transport: http(process.env.RPC_URL) });
const ESCROW_ADDRESS = (process.env.ESCROW_ADDRESS || '').toLowerCase();

const ESCROW_ABI = [
  { name: 'MatchCreated', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'playerA', type: 'address', indexed: true }, { name: 'stake', type: 'uint256', indexed: false }, { name: 'gameLogic', type: 'address', indexed: false }] },
  { name: 'MatchJoined', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'playerB', type: 'address', indexed: true }] },
  { name: 'RoundStarted', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'roundNumber', type: 'uint8', indexed: false }] },
  { name: 'MoveCommitted', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'roundNumber', type: 'uint8', indexed: false }, { name: 'player', type: 'address', indexed: true }, { name: 'commitHash', type: 'bytes32', indexed: false }] },
  { name: 'MoveRevealed', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'roundNumber', type: 'uint8', indexed: false }, { name: 'player', type: 'address', indexed: true }, { name: 'move', type: 'uint8', indexed: false }] },
  { name: 'RoundResolved', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'roundNumber', type: 'uint8', indexed: false }, { name: 'winner', type: 'uint8', indexed: false }] },
  { name: 'MatchSettled', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'winner', type: 'address', indexed: true }, { name: 'payout', type: 'uint256', indexed: false }] },
  { name: 'TimeoutClaimed', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'roundNumber', type: 'uint8', indexed: false }, { name: 'claimer', type: 'address', indexed: true }] },
  { name: 'WithdrawalQueued', type: 'event', inputs: [{ name: 'recipient', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }] },
  { name: 'GameLogicApproved', type: 'event', inputs: [{ name: 'logic', type: 'address', indexed: true }, { name: 'approved', type: 'bool', indexed: false }] },
  { name: 'getMatch', type: 'function', stateMutability: 'view', inputs: [{ name: '_matchId', type: 'uint256' }], outputs: [{ name: '', type: 'tuple', components: [
    { name: 'playerA', type: 'address' },
    { name: 'playerB', type: 'address' },
    { name: 'stake', type: 'uint256' },
    { name: 'gameLogic', type: 'address' },
    { name: 'winsA', type: 'uint8' },
    { name: 'winsB', type: 'uint8' },
    { name: 'currentRound', type: 'uint8' },
    { name: 'drawCounter', type: 'uint8' },
    { name: 'phase', type: 'uint8' },
    { name: 'status', type: 'uint8' },
    { name: 'commitDeadline', type: 'uint256' },
    { name: 'revealDeadline', type: 'uint256' }
  ] }] },
];

const processedLogIds = new Set<string>();
const BACKFILL_CHUNK = 10n;

async function withRetry<T>(fn: () => Promise<T>, retries = 5, delayMs = 2000): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try { return await fn(); } catch (err) {
      if (attempt === retries - 1) throw err;
      const wait = delayMs * Math.pow(2, attempt);
      logger.warn({ attempt: attempt + 1, wait, err: (err as any).message }, 'Retryable operation failed, backing off...');
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw new Error('unreachable');
}

function getDbMatchId(onChainId: any): string {
  return `${ESCROW_ADDRESS}-${onChainId.toString()}`;
}

async function getBlockTimestamp(blockNumber: bigint): Promise<number> {
  const block = await publicClient.getBlock({ blockNumber });
  return Number(block.timestamp);
}

async function syncMatchScore(dbMId: string) {
  try {
    const { data: rounds } = await supabase
      .from('rounds')
      .select('round_number, winner')
      .eq('match_id', dbMId)
      .not('winner', 'is', null);

    if (rounds) {
      // Create a map to ensure we only count each round once
      const roundWinners = new Map<number, number>();
      for (const r of rounds) {
        roundWinners.set(r.round_number, r.winner);
      }

      let winsA = 0;
      let winsB = 0;
      for (const winner of roundWinners.values()) {
        if (winner === 1) winsA++;
        else if (winner === 2) winsB++;
      }

      logger.info({ dbMId, winsA, winsB, uniqueRoundsCounted: roundWinners.size }, 'Syncing match score from rounds history');
      await supabase.from('matches').update({ wins_a: winsA, wins_b: winsB }).eq('match_id', dbMId);
    }
  } catch (err) {
    logger.error({ dbMId, err }, 'Failed to sync match score');
  }
}

async function ensureMatchExists(mId: string, onChainId: bigint) {
  const { data: existing } = await supabase.from('matches').select('match_id').eq('match_id', mId).single();
  if (existing) return;

  logger.info({ matchId: mId }, 'Match missing from DB, fetching from chain...');
  
  try {
    const matchData = await publicClient.readContract({
      address: ESCROW_ADDRESS as `0x${string}`,
      abi: ESCROW_ABI,
      functionName: 'getMatch',
      args: [onChainId]
    }) as any;

    const statusMap = ['OPEN', 'ACTIVE', 'SETTLED', 'VOIDED'];
    const phaseMap = ['COMMIT', 'REVEAL'];

    await supabase.from('matches').upsert({
      match_id: mId,
      player_a: matchData.playerA.toLowerCase(),
      player_b: matchData.playerB === '0x0000000000000000000000000000000000000000' ? null : matchData.playerB.toLowerCase(),
      stake_wei: matchData.stake.toString(),
      game_logic: matchData.gameLogic.toLowerCase(),
      wins_a: matchData.winsA,
      wins_b: matchData.winsB,
      current_round: matchData.currentRound,
      status: statusMap[matchData.status] || 'OPEN',
      phase: phaseMap[matchData.phase] || 'COMMIT',
      created_at: new Date().toISOString()
    });
  } catch (err: any) {
    logger.error({ matchId: mId, err: err.message }, 'Failed to fetch missing match from chain');
  }
}

async function main() {
  const { data: syncState } = await supabase.from('sync_state').select('last_processed_block').eq('id', 'indexer_main').single();
  const startBlockEnv = process.env.START_BLOCK ? BigInt(process.env.START_BLOCK) : 0n;
  const fromBlock = BigInt(syncState?.last_processed_block || startBlockEnv);
  const currentBlock = await publicClient.getBlockNumber();
  
  logger.info({ fromBlock, currentBlock }, 'Indexer starting...');

  const handleLogs = async (logs: any[]) => {
    const parsedLogs = parseEventLogs({ abi: ESCROW_ABI, logs });
    let lastBlock = 0n;
    for (const log of parsedLogs) {
      const logId = `${log.blockHash}-${log.logIndex}`;
      if (log.removed) continue;
      if (processedLogIds.has(logId)) continue;
      await processLog(log);
      processedLogIds.add(logId);
      if (log.blockNumber > lastBlock) lastBlock = log.blockNumber;
    }
    if (lastBlock > 0n) {
      await supabase.from('sync_state').upsert({ id: 'indexer_main', last_processed_block: Number(lastBlock) });
    }
  };

  if (currentBlock > fromBlock) {
    let cursor = fromBlock + 1n;
    while (cursor <= currentBlock) {
      const toChunk = cursor + BACKFILL_CHUNK - 1n < currentBlock ? cursor + BACKFILL_CHUNK - 1n : currentBlock;
      const logs = await withRetry(() => publicClient.getLogs({ address: ESCROW_ADDRESS as `0x${string}`, fromBlock: cursor, toBlock: toChunk })) as any[];
      await handleLogs(logs);
      cursor = toChunk + 1n;
      await new Promise(r => setTimeout(r, 500));
    }
  }

  publicClient.watchEvent({ address: ESCROW_ADDRESS as `0x${string}`, onLogs: handleLogs });
}

async function processLog(log: any) {
  const { eventName, args, blockNumber } = log;
  const mId = args.matchId ? getDbMatchId(args.matchId) : null;

  if (mId && eventName !== 'MatchCreated') {
    await ensureMatchExists(mId, BigInt(args.matchId));
  }

  if (eventName === 'MatchCreated') {
    await supabase.from('matches').upsert({ 
      match_id: mId, 
      player_a: args.playerA.toLowerCase(), 
      stake_wei: args.stake.toString(), 
      game_logic: args.gameLogic.toLowerCase(), 
      status: 'OPEN', 
      phase: 'COMMIT', 
      current_round: 1,
      wins_a: 0,
      wins_b: 0
    });
  } else if (eventName === 'MatchJoined') {
    const ts = await getBlockTimestamp(blockNumber);
    await supabase.from('matches').update({ 
      player_b: args.playerB.toLowerCase(), 
      status: 'ACTIVE', 
      commit_deadline: new Date((ts + 3600) * 1000).toISOString() 
    }).eq('match_id', mId);
  } else if (eventName === 'RoundStarted') {
    const ts = await getBlockTimestamp(blockNumber);
    await supabase.from('matches').update({ 
      current_round: args.roundNumber, 
      phase: 'COMMIT', 
      commit_deadline: new Date((ts + 3600) * 1000).toISOString() 
    }).eq('match_id', mId);
    // Cleanup ONLY for sudden death replays (draw → same round re-played).
    // Only delete if existing entries for this round have winner=0 (draw).
    // This guard prevents accidental deletion of resolved round data.
    const { data: existingRound } = await supabase.from('rounds')
      .select('winner')
      .match({ match_id: mId, round_number: args.roundNumber })
      .limit(1);
    if (existingRound && existingRound.length > 0 && existingRound[0].winner === 0) {
      logger.info({ matchId: mId, round: args.roundNumber }, 'Sudden death: clearing draw round for replay');
      await supabase.from('rounds').delete().match({ match_id: mId, round_number: args.roundNumber });
    }
  } else if (eventName === 'MoveCommitted') {
    const { data: match } = await supabase.from('matches').select('player_a').eq('match_id', mId).single();
    const playerLower = args.player.toLowerCase();
    const pIndex = playerLower === match?.player_a ? 1 : 2;
    await supabase.from('rounds').upsert({ 
      match_id: mId, 
      round_number: args.roundNumber, 
      player_address: playerLower, 
      player_index: pIndex, 
      commit_hash: args.commitHash,
      revealed: false,
      commit_tx_hash: log.transactionHash 
    }, { onConflict: 'match_id,round_number,player_address' });

    const { data: roundEntries } = await supabase.from('rounds').select('player_address').match({ match_id: mId, round_number: args.roundNumber });
    if (roundEntries && roundEntries.length === 2) {
      const ts = await getBlockTimestamp(blockNumber);
      await supabase.from('matches').update({ phase: 'REVEAL', reveal_deadline: new Date((ts + 3600) * 1000).toISOString() }).eq('match_id', mId);
    }
  } else if (eventName === 'MoveRevealed') {
    const { data: match } = await supabase.from('matches').select('player_a').eq('match_id', mId).single();
    const playerLower = args.player.toLowerCase();
    const pIndex = playerLower === match?.player_a ? 1 : 2;

    // Step 1: Write to hidden_move (NOT move). Use .update() to avoid nuking commit_hash.
    const { data: updated } = await supabase.from('rounds').update({
      hidden_move: args.move,
      revealed: true,
      reveal_tx_hash: log.transactionHash
    }).match({ match_id: mId, round_number: args.roundNumber, player_address: playerLower }).select();

    // Fallback: if update hit 0 rows (missed MoveCommitted), insert the row
    if (!updated || updated.length === 0) {
      logger.warn({ matchId: mId, round: args.roundNumber, player: playerLower }, 'MoveRevealed: row missing, inserting');
      await supabase.from('rounds').upsert({
        match_id: mId,
        round_number: args.roundNumber,
        player_address: playerLower,
        player_index: pIndex,
        hidden_move: args.move,
        revealed: true,
        reveal_tx_hash: log.transactionHash
      }, { onConflict: 'match_id,round_number,player_address' });
    }

    // Step 2: Dual-Reveal Gate — check if BOTH players have now revealed for this round
    const { data: revealedRows } = await supabase.from('rounds')
      .select('player_address, hidden_move')
      .match({ match_id: mId, round_number: args.roundNumber, revealed: true })
      .not('hidden_move', 'is', null);

    if (revealedRows && revealedRows.length >= 2) {
      // Both revealed! Unmask hidden_move → move for BOTH players simultaneously
      for (const row of revealedRows) {
        await supabase.from('rounds').update({ move: row.hidden_move })
          .match({ match_id: mId, round_number: args.roundNumber, player_address: row.player_address });
      }
      logger.info({ matchId: mId, round: args.roundNumber }, '🎭 Both moves unmasked simultaneously');
    }
  } else if (eventName === 'RoundResolved') {
    // Safety net: ensure any hidden_move values are copied to move before resolving
    const { data: hiddenRows } = await supabase.from('rounds')
      .select('player_address, hidden_move, move')
      .match({ match_id: mId, round_number: args.roundNumber })
      .not('hidden_move', 'is', null);

    if (hiddenRows) {
      for (const row of hiddenRows) {
        if (row.move === null || row.move === undefined) {
          await supabase.from('rounds').update({ move: row.hidden_move })
            .match({ match_id: mId, round_number: args.roundNumber, player_address: row.player_address });
        }
      }
    }

    // Update the winner
    await supabase.from('rounds').update({ winner: args.winner }).match({ match_id: mId, round_number: args.roundNumber });

    // Robust Win Count Fix
    await syncMatchScore(mId!);
  } else if (eventName === 'MatchSettled') {
    const winnerLower = args.winner.toLowerCase();
    const isVoid = winnerLower === '0x0000000000000000000000000000000000000000' && args.payout === 0n;
    
    // Update the match record
    await supabase.from('matches').update({ 
      status: isVoid ? 'VOIDED' : 'SETTLED', 
      winner: winnerLower, 
      payout_wei: args.payout.toString(),
      phase: 'COMPLETE',
      settle_tx_hash: log.transactionHash
    }).eq('match_id', mId);

    // If not voided, update player win/loss/elo stats
    if (!isVoid) {
      const { data: match } = await supabase.from('matches').select('player_a, player_b').eq('match_id', mId).single();
      if (match && match.player_b) {
        let winnerIndex = 0; // Draw
        if (winnerLower === match.player_a) winnerIndex = 1;
        else if (winnerLower === match.player_b) winnerIndex = 2;

        logger.info({ matchId: mId, playerA: match.player_a, playerB: match.player_b, winnerIndex }, 'Settling match stats via RPC...');
        const { error: rpcError } = await supabase.rpc('settle_match_elo', {
          p_player_a: match.player_a,
          p_player_b: match.player_b,
          p_winner_index: winnerIndex
        });

        if (rpcError) {
          logger.error({ mId, rpcError }, 'Failed to call settle_match_elo RPC');
        } else {
          logger.info({ mId }, 'Successfully updated player stats via RPC');
        }
      }
    }
  }
}

main().catch(err => logger.error(err, 'Fatal error in main loop'));
