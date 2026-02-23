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
  { name: 'MoveCommitted', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'roundNumber', type: 'uint8', indexed: false }, { name: 'player', type: 'address', indexed: true }] },
  { name: 'MoveRevealed', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'roundNumber', type: 'uint8', indexed: false }, { name: 'player', type: 'address', indexed: true }, { name: 'move', type: 'uint8', indexed: false }] },
  { name: 'RoundResolved', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'roundNumber', type: 'uint8', indexed: false }, { name: 'winner', type: 'uint8', indexed: false }] },
  { name: 'MatchSettled', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'winner', type: 'address', indexed: true }, { name: 'payout', type: 'uint256', indexed: false }] },
  { name: 'TimeoutClaimed', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'roundNumber', type: 'uint8', indexed: false }, { name: 'claimer', type: 'address', indexed: true }] },
  { name: 'WithdrawalQueued', type: 'event', inputs: [{ name: 'recipient', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }] },
  { name: 'GameLogicApproved', type: 'event', inputs: [{ name: 'logic', type: 'address', indexed: true }, { name: 'approved', type: 'bool', indexed: false }] },
];

const processedLogIds = new Set<string>();
// Alchemy Free Tier Limit: 10 blocks
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

    // Map on-chain status/phase indices to strings
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
      created_at: new Date().toISOString() // Fallback since we don't have block TS here
    });
    logger.info({ matchId: mId }, 'Successfully backfilled missing match from chain');
  } catch (err: any) {
    logger.error({ matchId: mId, err: err.message }, 'Failed to fetch missing match from chain');
  }
}

async function main() {
  logger.info({ 
    escrow: process.env.ESCROW_ADDRESS, 
    supabase: process.env.SUPABASE_URL 
  }, 'Indexer environment check');

  if (!ESCROW_ADDRESS || ESCROW_ADDRESS.includes('tbd')) {
    logger.error('❌ ESCROW_ADDRESS is missing or still set to TBD. You MUST deploy the contracts first using pnpm contracts:deploy.');
    process.exit(1);
  }

  const { data: syncState } = await supabase.from('sync_state').select('last_processed_block').eq('id', 'indexer_main').single();
  
  const startBlockEnv = process.env.START_BLOCK ? BigInt(process.env.START_BLOCK) : 0n;
  const fromBlock = BigInt(syncState?.last_processed_block || startBlockEnv);
  const currentBlock = await publicClient.getBlockNumber();
  
  logger.info({ chain: baseSepolia.name, fromBlock, currentBlock, escrow: ESCROW_ADDRESS }, 'Indexer starting...');

  const handleLogs = async (logs: any[]) => {
    const parsedLogs = parseEventLogs({ abi: ESCROW_ABI, logs });
    let lastBlock = 0n;
    for (const log of parsedLogs) {
      const logId = `${log.blockHash}-${log.logIndex}`;
      if (log.removed) { 
        await handleReorg(log); 
        processedLogIds.delete(logId); 
        continue; 
      }
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
    logger.info(`Catching up: ${fromBlock} -> ${currentBlock}`);
    let totalLogs = 0;
    let cursor = fromBlock + 1n;
    while (cursor <= currentBlock) {
      const toChunk = cursor + BACKFILL_CHUNK - 1n < currentBlock ? cursor + BACKFILL_CHUNK - 1n : currentBlock;
      try {
        const logs = await withRetry(() => publicClient.getLogs({ 
          address: ESCROW_ADDRESS as `0x${string}`, 
          fromBlock: cursor, 
          toBlock: toChunk 
        })) as any[];
        await handleLogs(logs);
        totalLogs += logs.length;
        cursor = toChunk + 1n;
        
        // Rate limit protection: Sleep 500ms between chunks
        await new Promise(r => setTimeout(r, 500));
      } catch (err: any) {
        if (err.message.includes('429')) {
          logger.warn('Rate limited by RPC. Sleeping for 5 seconds...');
          await new Promise(r => setTimeout(r, 5000));
          continue; // Try same chunk
        }
        logger.error({ from: cursor, to: toChunk, err: err.message }, 'Failed to fetch logs, skipping chunk');
        cursor = toChunk + 1n;
      }
    }
    logger.info({ totalLogs }, 'Backfill complete.');
  }

  publicClient.watchEvent({ address: ESCROW_ADDRESS as `0x${string}`, onLogs: handleLogs });
  logger.info('Listening for new events...');
}

async function handleReorg(log: any) {
  const { eventName, args } = log;
  const mId = getDbMatchId(args.matchId);
  logger.warn({ eventName, matchId: mId }, '[REORG] Reverting event');

  if (eventName === 'MatchCreated') {
    await supabase.from('matches').delete().eq('match_id', mId);
  } else if (eventName === 'MatchJoined') {
    await supabase.from('matches').update({ player_b: null, status: 'OPEN' }).eq('match_id', mId);
  } else if (eventName === 'MoveCommitted') {
    await supabase.from('rounds').delete().match({ match_id: mId, round_number: args.roundNumber, player_address: args.player.toLowerCase() });
    await supabase.from('matches').update({ phase: 'COMMIT' }).eq('match_id', mId);
  } else if (eventName === 'MoveRevealed') {
    await supabase.from('rounds').update({ revealed: false, move: null }).match({ match_id: mId, round_number: args.roundNumber, player_address: args.player.toLowerCase() });
  } else if (eventName === 'RoundResolved') {
    const { winner } = args;
    if (winner === 1) await supabase.rpc('decrement_wins_a', { m_id: mId });
    else if (winner === 2) await supabase.rpc('decrement_wins_b', { m_id: mId });
    await supabase.from('rounds').update({ winner: null }).match({ match_id: mId, round_number: args.roundNumber });
  } else if (eventName === 'MatchSettled') {
    await supabase.from('matches').update({ status: 'ACTIVE', winner: null, payout_wei: null }).eq('match_id', mId);
  }
}

async function processLog(log: any) {
  const { eventName, args, blockNumber } = log;
  const mId = args.matchId ? getDbMatchId(args.matchId) : null;

  logger.info({ eventName, matchId: mId, blockNumber }, 'Processing event');

  // Ensure parent match exists for all match-related events
  if (mId && eventName !== 'MatchCreated') {
    await ensureMatchExists(mId, BigInt(args.matchId));
  }

  if (eventName === 'MatchCreated') {
    const playerA = args.playerA.toLowerCase();
    await supabase.from('matches').upsert({ match_id: mId, player_a: playerA, stake_wei: args.stake.toString(), game_logic: args.gameLogic.toLowerCase(), status: 'OPEN', phase: 'COMMIT', current_round: 1 });
    await supabase.from('agent_profiles').upsert({ address: playerA, last_active: new Date().toISOString() }, { onConflict: 'address' });
  } else if (eventName === 'MatchJoined') {
    const ts = await getBlockTimestamp(blockNumber);
    const playerB = args.playerB.toLowerCase();
    logger.info({ matchId: mId, playerB, status: 'ACTIVE' }, 'UPDATING MATCH TO ACTIVE');
    const { error } = await supabase.from('matches').update({ 
      player_b: playerB, 
      status: 'ACTIVE', 
      commit_deadline: new Date((ts + 3600) * 1000).toISOString() 
    }).eq('match_id', mId);
    if (error) logger.error({ mId, error }, 'Failed to update MatchJoined in Supabase');
    await supabase.from('agent_profiles').upsert({ address: playerB, last_active: new Date().toISOString() }, { onConflict: 'address' });
  } else if (eventName === 'RoundStarted') {
    const ts = await getBlockTimestamp(blockNumber);
    logger.info({ matchId: mId, round: args.roundNumber }, 'UPDATING MATCH ROUND AND PHASE');
    const { error } = await supabase.from('matches').update({ 
      current_round: args.roundNumber, 
      phase: 'COMMIT', 
      commit_deadline: new Date((ts + 3600) * 1000).toISOString() 
    }).eq('match_id', mId);
    if (error) logger.error({ mId, error }, 'Failed to update RoundStarted in Supabase');
  } else if (eventName === 'MoveCommitted') {
    const { data: match } = await supabase.from('matches').select('player_a').eq('match_id', mId).single();
    const playerLower = args.player.toLowerCase();
    const pIndex = playerLower === match?.player_a ? 1 : 2;
    const { error: rError } = await supabase.from('rounds').upsert({ 
      match_id: mId, 
      round_number: args.roundNumber, 
      player_address: playerLower, 
      player_index: pIndex, 
      revealed: false,
      commit_tx_hash: log.transactionHash 
    });
    if (rError) logger.error({ mId, playerLower, rError }, 'Failed to upsert Round MoveCommitted');

    const { data: roundEntries } = await supabase.from('rounds').select('player_address').match({ match_id: mId, round_number: args.roundNumber });
    if (roundEntries && roundEntries.length === 2) {
      const ts = await getBlockTimestamp(blockNumber);
      logger.info({ matchId: mId, phase: 'REVEAL' }, 'TRANSITIONING TO REVEAL PHASE');
      const { error: mError } = await supabase.from('matches').update({ phase: 'REVEAL', reveal_deadline: new Date((ts + 3600) * 1000).toISOString() }).eq('match_id', mId);
      if (mError) logger.error({ mId, mError }, 'Failed to transition to REVEAL phase');
    }
  } else if (eventName === 'MoveRevealed') {
    const { data: match } = await supabase.from('matches').select('player_a').eq('match_id', mId).single();
    const playerLower = args.player.toLowerCase();
    const pIndex = playerLower === match?.player_a ? 1 : 2;
    
    const { error: rvError } = await supabase.from('rounds').upsert({ 
      match_id: mId, 
      round_number: args.roundNumber, 
      player_address: playerLower, 
      player_index: pIndex,
      move: args.move, 
      revealed: true,
      reveal_tx_hash: log.transactionHash
    });
    if (rvError) logger.error({ mId, rvError }, 'Failed to upsert Round MoveRevealed');
  } else if (eventName === 'RoundResolved') {
    if (args.winner === 1) await supabase.rpc('increment_wins_a', { m_id: mId });
    else if (args.winner === 2) await supabase.rpc('increment_wins_b', { m_id: mId });
    await supabase.from('rounds').update({ winner: args.winner }).match({ match_id: mId, round_number: args.roundNumber });
  } else if (eventName === 'MatchSettled') {
    const winnerLower = args.winner.toLowerCase();
    const isVoid = winnerLower === '0x0000000000000000000000000000000000000000' && args.payout === 0n;
    const isTie = winnerLower === '0x0000000000000000000000000000000000000000' && args.payout > 0n;
    await supabase.from('matches').update({ 
      status: isVoid ? 'VOIDED' : 'SETTLED', 
      winner: winnerLower, 
      payout_wei: args.payout.toString(),
      phase: 'COMPLETE',
      settle_tx_hash: log.transactionHash
    }).eq('match_id', mId);
    if (!isVoid) {
      const { data: m } = await supabase.from('matches').select('player_a, player_b').eq('match_id', mId).single();
      if (m && m.player_b) {
        const winnerIndex = isTie ? 0 : (winnerLower === m.player_a ? 1 : 2);
        await supabase.rpc('settle_match_elo', { p_player_a: m.player_a, p_player_b: m.player_b, p_winner_index: winnerIndex });
      }
    }
  } else if (eventName === 'WithdrawalQueued') {
    logger.info({ amount: args.amount.toString(), recipient: args.recipient }, 'Withdrawal queued');
  }
}

main().catch(err => logger.error(err, 'Fatal error in main loop'));
