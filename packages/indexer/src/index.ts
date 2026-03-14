import { createPublicClient, http, parseEventLogs } from 'viem';
import { baseSepolia } from 'viem/chains';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const logger = pino({
  name: 'falken-indexer-v4',
  transport: { target: 'pino-pretty' }
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ESCROW_ADDRESS = process.env.POKER_ENGINE_ADDRESS || process.env.ESCROW_ADDRESS;
const RPC_URL = process.env.RPC_URL;

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL)
});

const POKER_ENGINE_ABI = [
  { name: 'MatchCreated', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'creator', type: 'address', indexed: true }, { name: 'stake', type: 'uint256', indexed: false }, { name: 'logicId', type: 'bytes32', indexed: true }, { name: 'maxPlayers', type: 'uint8', indexed: false }, { name: 'maxRounds', type: 'uint8', indexed: false }] },
  { name: 'PlayerJoined', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'player', type: 'address', indexed: true }, { name: 'playerIndex', type: 'uint8', indexed: false }] },
  { name: 'MatchActivated', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }] },
  { name: 'BetPlaced', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'player', type: 'address', indexed: true }, { name: 'action', type: 'uint8', indexed: false }, { name: 'amount', type: 'uint256', indexed: false }] },
  { name: 'PlayerFolded', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'player', type: 'address', indexed: true }, { name: 'playerIndex', type: 'uint8', indexed: false }] },
  { name: 'MoveCommitted', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'round', type: 'uint8', indexed: false }, { name: 'player', type: 'address', indexed: true }] },
  { name: 'MoveRevealed', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'round', type: 'uint8', indexed: false }, { name: 'player', type: 'address', indexed: true }, { name: 'move', type: 'bytes32', indexed: false }] },
  { name: 'StreetAdvanced', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'round', type: 'uint8', indexed: false }, { name: 'newStreet', type: 'uint8', indexed: false }] },
  { name: 'RoundResolved', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'round', type: 'uint8', indexed: false }, { name: 'winnerIndex', type: 'uint8', indexed: false }] },
  { name: 'MatchSettled', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'winnerIndices', type: 'uint8[]', indexed: false }, { name: 'payout', type: 'uint256', indexed: false }, { name: 'rake', type: 'uint256', indexed: false }] },
  { name: 'MatchVoided', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'reason', type: 'string', indexed: false }] },
  { name: 'TimeoutClaimed', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'claimer', type: 'address', indexed: true }, { name: 'winnerIndex', type: 'uint8', indexed: false }] },
  { name: 'getMatch', type: 'function', inputs: [{ name: 'matchId', type: 'uint256' }], outputs: [{ type: 'tuple', components: [{ name: 'players', type: 'address[]' }, { name: 'stake', type: 'uint256' }, { name: 'totalPot', type: 'uint256' }, { name: 'logicId', type: 'bytes32' }, { name: 'maxPlayers', type: 'uint8' }, { name: 'maxRounds', type: 'uint8' }, { name: 'currentRound', type: 'uint8' }, { name: 'wins', type: 'uint8[]' }, { name: 'drawCounter', type: 'uint8' }, { name: 'winsRequired', type: 'uint8' }, { name: 'status', type: 'uint8' }, { name: 'winner', type: 'address' }, { name: 'createdAt', type: 'uint256' }] }] },
  { name: 'getPokerState', type: 'function', inputs: [{ name: 'matchId', type: 'uint256' }], outputs: [{ type: 'tuple', components: [{ name: 'phase', type: 'uint8' }, { name: 'betStructure', type: 'uint8' }, { name: 'maxStreets', type: 'uint8' }, { name: 'street', type: 'uint8' }, { name: 'activePlayers', type: 'uint8' }, { name: 'raiseCount', type: 'uint8' }, { name: 'playersToAct', type: 'uint8' }, { name: 'currentBet', type: 'uint256' }, { name: 'maxBuyIn', type: 'uint256' }, { name: 'commitDeadline', type: 'uint256' }, { name: 'betDeadline', type: 'uint256' }, { name: 'revealDeadline', type: 'uint256' }, { name: 'folded', type: 'bool[]' }, { name: 'streetBets', type: 'uint256[]' }] }] }
] as const;

const processedLogIds = new Set<string>();
const BACKFILL_CHUNK = 2000n;

function getDbMatchId(onChainId: bigint): string {
  return `${ESCROW_ADDRESS!.toLowerCase()}-${onChainId.toString()}`;
}

async function ensureMatchExists(mId: string, onChainId: bigint) {
  const { data: existing } = await supabase.from('matches').select('match_id').eq('match_id', mId).single();
  if (existing) return;

  logger.info({ matchId: mId }, 'Match missing from DB, fetching from chain...');

  try {
    const matchData = await publicClient.readContract({
      address: ESCROW_ADDRESS as `0x${string}`,
      abi: POKER_ENGINE_ABI,
      functionName: 'getMatch',
      args: [onChainId]
    }) as any;

    const pokerState = await publicClient.readContract({
      address: ESCROW_ADDRESS as `0x${string}`,
      abi: POKER_ENGINE_ABI,
      functionName: 'getPokerState',
      args: [onChainId]
    }) as any;

    const statusMap = ['OPEN', 'ACTIVE', 'SETTLED', 'VOIDED'];
    const phaseMap = ['COMMIT', 'BET', 'REVEAL'];

    await supabase.from('matches').upsert({
      match_id: mId,
      escrow_address: ESCROW_ADDRESS,
      players: matchData.players.map((p: string) => p.toLowerCase()),
      stake_wei: Number(matchData.stake),
      total_pot: Number(matchData.totalPot),
      game_logic: matchData.logicId.toLowerCase(),
      wins: matchData.wins,
      current_round: matchData.currentRound,
      current_street: pokerState.street,
      draw_counter: matchData.drawCounter,
      wins_required: matchData.winsRequired,
      max_rounds: matchData.maxRounds,
      status: statusMap[matchData.status] || 'OPEN',
      phase: phaseMap[pokerState.phase] || 'COMMIT',
      winner: matchData.winner === '0x0000000000000000000000000000000000000000' ? null : matchData.winner?.toLowerCase(),
      created_at: new Date(Number(matchData.createdAt) * 1000).toISOString(),
      commit_deadline: pokerState.commitDeadline ? new Date(Number(pokerState.commitDeadline) * 1000).toISOString() : null,
      bet_deadline: pokerState.betDeadline ? new Date(Number(pokerState.betDeadline) * 1000).toISOString() : null,
      reveal_deadline: pokerState.revealDeadline ? new Date(Number(pokerState.revealDeadline) * 1000).toISOString() : null
    });
  } catch (err: any) {
    logger.error({ matchId: mId, err: err.message }, 'Failed to fetch missing match from chain');
  }
}

export async function startIndexer() {
  const { data: syncState } = await supabase.from('sync_state').select('last_processed_block').eq('id', 'indexer_v4').single();
  const startBlockEnv = process.env.START_BLOCK ? BigInt(process.env.START_BLOCK) : 0n;
  const fromBlock = BigInt(syncState?.last_processed_block || startBlockEnv);
  const currentBlock = await publicClient.getBlockNumber();

  logger.info({ fromBlock, currentBlock, escrow: ESCROW_ADDRESS }, 'V4 Indexer starting...');

  const handleLogs = async (logs: any[]) => {
    const parsedLogs = parseEventLogs({ abi: POKER_ENGINE_ABI, logs }) as any[];
    let lastBlock = fromBlock;
    for (const log of parsedLogs) {
      const logId = `${log.blockHash}-${log.logIndex}`;
      if (log.removed || processedLogIds.has(logId)) continue;
      await processLog(log);
      processedLogIds.add(logId);
      if (log.blockNumber > lastBlock) lastBlock = log.blockNumber;
    }
    if (lastBlock > fromBlock) {
      await supabase.from('sync_state').upsert({ id: 'indexer_v4', last_processed_block: Number(lastBlock) });
    }
  };

  if (currentBlock > fromBlock) {
    let cursor = fromBlock + 1n;
    while (cursor <= currentBlock) {
      const toChunk = cursor + BACKFILL_CHUNK - 1n < currentBlock ? cursor + BACKFILL_CHUNK - 1n : currentBlock;
      logger.info({ cursor, toChunk }, 'Fetching historical logs...');
      const logs = await publicClient.getLogs({
        address: ESCROW_ADDRESS as `0x${string}`,
        fromBlock: cursor,
        toBlock: toChunk
      });
      await handleLogs(logs);
      cursor = toChunk + 1n;
    }
  }

  logger.info('Switching to watch mode...');
  publicClient.watchEvent({ address: ESCROW_ADDRESS as `0x${string}`, onLogs: handleLogs });
}

async function processLog(log: any) {
  const { eventName, args, blockNumber, transactionHash: txHash } = log;
  const mId = args.matchId ? getDbMatchId(args.matchId) : null;

  logger.info({ eventName, txHash, mId }, 'Processing log details');

  if (eventName === 'MatchCreated') {
    await supabase.from('matches').upsert({
      match_id: mId,
      escrow_address: ESCROW_ADDRESS,
      players: [args.creator.toLowerCase()],
      stake_wei: Number(args.stake),
      game_logic: args.logicId.toLowerCase(),
      max_rounds: args.maxRounds,
      status: 'OPEN',
      phase: 'COMMIT',
      current_round: 1,
      current_street: 0,
      wins: Array(args.maxPlayers).fill(0)
    });

  } else if (eventName === 'PlayerJoined') {
    const { data: match } = await supabase.from('matches').select('players').eq('match_id', mId).single();
    if (match) {
      const playerLower = args.player.toLowerCase();
      const existingPlayers = match.players || [];
      
      // Avoid duplicates - check if player already exists
      if (!existingPlayers.includes(playerLower)) {
        const updatedPlayers = [...existingPlayers, playerLower];
        await supabase.from('matches').update({ players: updatedPlayers }).eq('match_id', mId);
      }
    }

  } else if (eventName === 'MatchActivated') {
    await supabase.from('matches').update({ status: 'ACTIVE' }).eq('match_id', mId);

  } else if (eventName === 'BetPlaced') {
    const actions = ['CHECK', 'CALL', 'RAISE', 'FOLD', 'ALL_IN'];
    const { data: match } = await supabase.from('matches').select('current_round, current_street, total_pot').eq('match_id', mId).single();
    
    await supabase.from('match_actions').insert({
      match_id: mId,
      round_number: match?.current_round || 1,
      street: match?.current_street || 0,
      player_address: args.player.toLowerCase(),
      action_type: actions[args.action] || 'CHECK',
      amount: Number(args.amount),
      tx_hash: txHash
    });

    // Update match total pot
    if (match) {
      await supabase.from('matches').update({ 
        total_pot: Number(match.total_pot) + Number(args.amount) 
      }).eq('match_id', mId);
    }

  } else if (eventName === 'MoveCommitted') {
    // Basic tracking, moves are revealed later
    logger.info({ mId, player: args.player }, 'Move committed');

  } else if (eventName === 'MoveRevealed') {
    const { data: match } = await supabase.from('matches').select('current_street, players').eq('match_id', mId).single();
    // Remove duplicates from players array before finding index
    const uniquePlayers = [...new Set((match?.players || []) as string[])];
    const playerIndex = uniquePlayers.findIndex((p: string) => p.toLowerCase() === args.player.toLowerCase());
    await supabase.from('rounds').upsert({
      match_id: mId,
      round_number: Number(args.round),
      street: match?.current_street || 0,
      player_address: args.player.toLowerCase(),
      player_index: playerIndex >= 0 ? playerIndex : 0,
      move_bytes32: args.move,
      revealed: true,
      reveal_tx_hash: txHash
    }, { onConflict: 'match_id,round_number,street,player_address' });

  } else if (eventName === 'StreetAdvanced') {
    // Fetch updated poker state to get new deadlines
    const pokerState = await publicClient.readContract({
      address: ESCROW_ADDRESS as `0x${string}`,
      abi: POKER_ENGINE_ABI,
      functionName: 'getPokerState',
      args: [args.matchId]
    }) as any;
    await supabase.from('matches').update({ 
      current_street: Number(args.newStreet),
      phase: 'COMMIT',
      commit_deadline: pokerState.commitDeadline ? new Date(Number(pokerState.commitDeadline) * 1000).toISOString() : null,
      bet_deadline: pokerState.betDeadline ? new Date(Number(pokerState.betDeadline) * 1000).toISOString() : null,
      reveal_deadline: pokerState.revealDeadline ? new Date(Number(pokerState.revealDeadline) * 1000).toISOString() : null
    }).eq('match_id', mId);

  } else if (eventName === 'PlayerFolded') {
    // Track fold in match_actions for UI display
    await supabase.from('match_actions').insert({
      match_id: mId,
      round_number: 0, // Will be updated from match current_round
      player_address: args.player.toLowerCase(),
      action_type: 'FOLD',
      tx_hash: txHash
    });

  } else if (eventName === 'RoundResolved') {
    const winnerIdx = Number(args.winnerIndex);
    const roundNum = Number(args.round);
    
    // Map contract winner index to schema: 0=Draw, 1=PlayerA, 2=PlayerB
    const schemaWinner = winnerIdx === 255 ? 0 : winnerIdx === 0 ? 1 : 2;
    
    // Update rounds table with winner for this round
    await supabase.from('rounds').update({ winner: schemaWinner }).eq('match_id', mId).eq('round_number', roundNum);
    
    // Update match wins array and increment round
    const { data: match } = await supabase.from('matches').select('wins, draw_counter, current_round').eq('match_id', mId).single();
    if (match) {
      const wins = [...match.wins];
      let drawCounter = match.draw_counter;
      
      if (winnerIdx === 255) {
        drawCounter++;
      } else {
        wins[winnerIdx]++;
      }

      // Fetch updated poker state to get new deadlines for next round
      const pokerState = await publicClient.readContract({
        address: ESCROW_ADDRESS as `0x${string}`,
        abi: POKER_ENGINE_ABI,
        functionName: 'getPokerState',
        args: [args.matchId]
      }) as any;
      await supabase.from('matches').update({ 
        wins, 
        draw_counter: drawCounter,
        current_round: roundNum + 1,
        phase: 'COMMIT',
        commit_deadline: pokerState.commitDeadline ? new Date(Number(pokerState.commitDeadline) * 1000).toISOString() : null,
        bet_deadline: pokerState.betDeadline ? new Date(Number(pokerState.betDeadline) * 1000).toISOString() : null,
        reveal_deadline: pokerState.revealDeadline ? new Date(Number(pokerState.revealDeadline) * 1000).toISOString() : null
      }).eq('match_id', mId);
    }

  } else if (eventName === 'TimeoutClaimed') {
    // Timeout settles match immediately - update wins array too
    const { data: match } = await supabase.from('matches').select('wins').eq('match_id', mId).single();
    const winnerIdx = Number(args.winnerIndex);
    const wins = match?.wins ? [...match.wins] : [0, 0];
    if (winnerIdx < wins.length) {
      wins[winnerIdx]++;
    }
    await supabase.from('matches').update({
      status: 'SETTLED',
      winner: winnerIdx,
      wins,
      settle_tx_hash: txHash,
      state_description: 'Timeout claimed'
    }).eq('match_id', mId);

  } else if (eventName === 'MatchSettled') {
    const winner = args.winnerIndices.length > 0 ? 'SETTLED' : 'VOIDED'; // Placeholder logic
    await supabase.from('matches').update({ 
      status: 'SETTLED',
      winner: args.winnerIndices.length === 1 ? args.winnerIndices[0] : null,
      settle_tx_hash: txHash
    }).eq('match_id', mId);

  } else if (eventName === 'MatchVoided') {
    await supabase.from('matches').update({ 
      status: 'VOIDED',
      state_description: args.reason 
    }).eq('match_id', mId);
    logger.info({ mId, reason: args.reason }, 'Match status updated to VOIDED');
  }
}

startIndexer().catch(err => logger.error(err));
