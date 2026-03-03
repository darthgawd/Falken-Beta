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

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(process.env.RPC_URL) });
const ESCROW_ADDRESS = (process.env.ESCROW_ADDRESS || '').toLowerCase();

const ESCROW_ABI = [
  { name: 'MoveCommitted', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'roundNumber', type: 'uint8', indexed: false }, { name: 'player', type: 'address', indexed: true }] },
  { name: 'MoveRevealed', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'roundNumber', type: 'uint8', indexed: false }, { name: 'player', type: 'address', indexed: true }, { name: 'move', type: 'uint8', indexed: false }] },
  { name: 'RoundResolved', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'roundNumber', type: 'uint8', indexed: false }, { name: 'winner', type: 'uint8', indexed: false }] },
];

async function withRetry<T>(fn: () => Promise<T>, retries = 5, delayMs = 2000): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try { return await fn(); } catch (err: any) {
      if (attempt === retries - 1) throw err;
      const wait = err.message.includes('429') ? delayMs * 5 : delayMs * Math.pow(2, attempt);
      logger.warn({ attempt: attempt + 1, wait, err: err.message }, 'Retryable operation failed, backing off...');
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw new Error('unreachable');
}

async function backfillRounds() {
  logger.info('🚀 Starting round backfill search...');

  const { data: matches } = await supabase.from('matches').select('match_id').order('created_at', { ascending: false });
  if (!matches) return;

  for (const match of matches) {
    const { count } = await supabase.from('rounds').select('*', { count: 'exact', head: true }).eq('match_id', match.match_id);
    
    if (count === 0) {
      const onChainId = BigInt(match.match_id.split('-').pop() || '0');
      logger.info({ matchId: match.match_id, onChainId }, 'Empty match found, fetching events...');

      const startBlock = BigInt(process.env.START_BLOCK || '38000000');
      const latestBlock = await withRetry(() => publicClient.getBlockNumber());
      const CHUNK_SIZE = 1000n; 
      
      const allLogs: any[] = [];
      let cursor = startBlock;

      while (cursor <= latestBlock) {
        const toBlock = cursor + CHUNK_SIZE - 1n > latestBlock ? latestBlock : cursor + CHUNK_SIZE - 1n;
        
        try {
          const logs = await withRetry(() => publicClient.getLogs({
            address: ESCROW_ADDRESS as `0x${string}`,
            fromBlock: cursor,
            toBlock
          }));
          
          // Manually filter by matchId since viem getLogs with args can be tricky for indexed uint256
          const filtered = logs.filter(l => {
            try {
              const parsed = parseEventLogs({ abi: ESCROW_ABI, logs: [l] });
              return parsed.length > 0 && ((parsed[0] as any).args).matchId === onChainId;
            } catch {
              return false;
            }
          });

          allLogs.push(...filtered);
          cursor = toBlock + 1n;
          await new Promise(r => setTimeout(r, 200)); // Rate limit buffer
        } catch (err: any) {
          logger.error({ from: cursor, to: toBlock, err: err.message }, 'Failed to fetch chunk, skipping');
          cursor = toBlock + 1n;
        }
      }

      allLogs.sort((a, b) => Number(a.blockNumber - b.blockNumber));
      
      const { data: mData } = await supabase.from('matches').select('player_a').eq('match_id', match.match_id).single();

      for (const log of allLogs) {
        const parsedLogs = parseEventLogs({ abi: ESCROW_ABI, logs: [log] });
        if (parsedLogs.length === 0) continue;
        
        const parsed: any = parsedLogs[0];
        const { eventName, args } = parsed;
        const playerLower = args.player?.toLowerCase();
        const pIndex = playerLower === mData?.player_a ? 1 : 2;

        if (eventName === 'MoveCommitted') {
          await supabase.from('rounds').upsert({
            match_id: match.match_id,
            round_number: args.roundNumber,
            player_address: playerLower,
            player_index: pIndex,
            revealed: false,
            commit_tx_hash: log.transactionHash
          });
        } else if (eventName === 'MoveRevealed') {
          await supabase.from('rounds').upsert({
            match_id: match.match_id,
            round_number: args.roundNumber,
            player_address: playerLower,
            player_index: pIndex,
            move: args.move,
            revealed: true,
            reveal_tx_hash: log.transactionHash
          });
        } else if (eventName === 'RoundResolved') {
          await supabase.from('rounds').update({ winner: args.winner }).match({ match_id: match.match_id, round_number: args.roundNumber });
        }
      }
      logger.info({ matchId: match.match_id, eventCount: allLogs.length }, '✅ Successfully backfilled rounds');
    }
  }
  logger.info('🏁 Backfill search complete.');
}

backfillRounds().catch(err => logger.error(err));
