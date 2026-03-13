import { createPublicClient, http, parseEventLogs, decodeFunctionData } from 'viem';
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
}, process.stderr);

const supabase: any = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const publicClient: any = createPublicClient({ chain: baseSepolia, transport: http(process.env.RPC_URL) });

// V4: Support multiple contract addresses
const POKER_ENGINE_ADDRESS = (process.env.POKER_ENGINE_ADDRESS || '').toLowerCase();
const FISE_ESCROW_ADDRESS = (process.env.ESCROW_ADDRESS || '').toLowerCase(); // Legacy V3

// V4: Use PokerEngine address if available, fallback to legacy
const ESCROW_ADDRESS = POKER_ENGINE_ADDRESS || FISE_ESCROW_ADDRESS;

if (!ESCROW_ADDRESS) {
  logger.error('CRITICAL: Neither POKER_ENGINE_ADDRESS nor ESCROW_ADDRESS set');
  process.exit(1);
}

logger.info({ escrowAddress: ESCROW_ADDRESS, isV4: !!POKER_ENGINE_ADDRESS }, 'Indexer starting...');

// V4 ABI - PokerEngine
const POKER_ENGINE_ABI = [
  // --- EVENTS (BaseEscrow) ---
  {
    name: 'MatchCreated',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'stake', type: 'uint256', indexed: false },
      { name: 'logicId', type: 'bytes32', indexed: true },
      { name: 'maxPlayers', type: 'uint8', indexed: false },
      { name: 'maxRounds', type: 'uint8', indexed: false }
    ]
  },
  {
    name: 'PlayerJoined',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'player', type: 'address', indexed: true },
      { name: 'playerIndex', type: 'uint8', indexed: false }
    ]
  },
  {
    name: 'MatchActivated',
    type: 'event',
    inputs: [{ name: 'matchId', type: 'uint256', indexed: true }]
  },
  {
    name: 'MatchSettled',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'winnerIndices', type: 'uint8[]', indexed: false },
      { name: 'payout', type: 'uint256', indexed: false },
      { name: 'rake', type: 'uint256', indexed: false }
    ]
  },
  {
    name: 'MatchVoided',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'reason', type: 'string', indexed: false }
    ]
  },
  {
    name: 'PlayerLeft',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'player', type: 'address', indexed: true }
    ]
  },
  // --- EVENTS (PokerEngine) ---
  {
    name: 'MoveCommitted',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'round', type: 'uint8', indexed: false },
      { name: 'player', type: 'address', indexed: true }
    ]
  },
  {
    name: 'MoveRevealed',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'round', type: 'uint8', indexed: false },
      { name: 'player', type: 'address', indexed: true },
      { name: 'move', type: 'bytes32', indexed: false }
    ]
  },
  {
    name: 'RoundResolved',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'round', type: 'uint8', indexed: false },
      { name: 'winnerIndex', type: 'uint8', indexed: false }
    ]
  },
  {
    name: 'BetPlaced',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'player', type: 'address', indexed: true },
      { name: 'action', type: 'uint8', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false }
    ]
  },
  {
    name: 'PlayerFolded',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'player', type: 'address', indexed: true },
      { name: 'playerIndex', type: 'uint8', indexed: false }
    ]
  },
  {
    name: 'StreetAdvanced',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'round', type: 'uint8', indexed: false },
      { name: 'newStreet', type: 'uint8', indexed: false }
    ]
  },
  // --- READ FUNCTIONS ---
  {
    name: 'getMatch',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [{
      name: '',
      type: 'tuple',
      components: [
        { name: 'players', type: 'address[]' },
        { name: 'stake', type: 'uint256' },
        { name: 'totalPot', type: 'uint256' },
        { name: 'logicId', type: 'bytes32' },
        { name: 'maxPlayers', type: 'uint8' },
        { name: 'maxRounds', type: 'uint8' },
        { name: 'currentRound', type: 'uint8' },
        { name: 'wins', type: 'uint8[]' },
        { name: 'drawCounter', type: 'uint8' },
        { name: 'winsRequired', type: 'uint8' },
        { name: 'status', type: 'uint8' },
        { name: 'winner', type: 'address' },
        { name: 'createdAt', type: 'uint256' }
      ]
    }]
  },
  {
    name: 'getPokerState',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [{
      name: '',
      type: 'tuple',
      components: [
        { name: 'phase', type: 'uint8' },
        { name: 'betStructure', type: 'uint8' },
        { name: 'maxStreets', type: 'uint8' },
        { name: 'street', type: 'uint8' },
        { name: 'activePlayers', type: 'uint8' },
        { name: 'raiseCount', type: 'uint8' },
        { name: 'playersToAct', type: 'uint8' },
        { name: 'currentBet', type: 'uint256' },
        { name: 'maxBuyIn', type: 'uint256' },
        { name: 'commitDeadline', type: 'uint256' },
        { name: 'betDeadline', type: 'uint256' },
        { name: 'revealDeadline', type: 'uint256' },
        { name: 'folded', type: 'bool[]' },
        { name: 'streetBets', type: 'uint256[]' }
      ]
    }]
  },
  {
    name: 'roundCommits',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'round', type: 'uint8' },
      { name: 'player', type: 'address' }
    ],
    outputs: [{
      name: '',
      type: 'tuple',
      components: [
        { name: 'commitHash', type: 'bytes32' },
        { name: 'move', type: 'bytes32' },
        { name: 'salt', type: 'bytes32' },
        { name: 'revealed', type: 'bool' }
      ]
    }]
  }
];

const processedLogIds = new Set<string>();
const BACKFILL_CHUNK = 2000n;

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
      abi: POKER_ENGINE_ABI,
      functionName: 'getMatch',
      args: [onChainId]
    }) as any;

    // V4: Get phase from getPokerState, not getMatch
    let pokerState;
    try {
      pokerState = await publicClient.readContract({
        address: ESCROW_ADDRESS as `0x${string}`,
        abi: POKER_ENGINE_ABI,
        functionName: 'getPokerState',
        args: [onChainId]
      }) as any;
    } catch (err) {
      // If getPokerState fails (not a PokerEngine), fallback to V3 logic
      pokerState = { phase: matchData.phase };
    }

    const statusMap = ['OPEN', 'ACTIVE', 'SETTLED', 'VOIDED'];
    const phaseMap = ['COMMIT', 'BET', 'REVEAL']; // V4: Added BET phase

    await supabase.from('matches').upsert({
      match_id: mId,
      players: matchData.players.map((p: string) => p.toLowerCase()),
      stake_wei: matchData.stake.toString(),
      total_pot: matchData.totalPot.toString(),
      game_logic: matchData.logicId.toLowerCase(),
      wins: matchData.wins,
      current_round: matchData.currentRound,
      status: statusMap[matchData.status] || 'OPEN',
      phase: phaseMap[pokerState.phase] || 'COMMIT',
      max_players: matchData.maxPlayers,
      max_rounds: matchData.maxRounds, // V4: maxRounds instead of winsRequired
      draw_counter: matchData.drawCounter,
      winner: matchData.winner?.toLowerCase(),
      created_at: new Date().toISOString()
    });
  } catch (err: any) {
    logger.error({ matchId: mId, err: err.message }, 'Failed to fetch missing match from chain');
  }
}

export async function startIndexer() {
  // V4: Use indexer_v4 sync state key
  const { data: syncState } = await supabase.from('sync_state').select('last_processed_block').eq('id', 'indexer_v4').single();
  const startBlockEnv = process.env.START_BLOCK ? BigInt(process.env.START_BLOCK) : 0n;
  const fromBlock = BigInt(syncState?.last_processed_block || startBlockEnv);
  const currentBlock = await publicClient.getBlockNumber();

  logger.info({ fromBlock, currentBlock, escrow: ESCROW_ADDRESS }, 'V4 Indexer starting...');

  const handleLogs = async (logs: any[]) => {
    const parsedLogs = parseEventLogs({ abi: POKER_ENGINE_ABI, logs }) as any[];
    let lastBlock = 0n;
    for (const log of parsedLogs) {
      const logId = `${log.blockHash}-${log.logIndex}`;
      if (log.removed || processedLogIds.has(logId)) continue;
      await processLog(log);
      processedLogIds.add(logId);
      if (log.blockNumber > lastBlock) lastBlock = log.blockNumber;
    }
    if (lastBlock > 0n) {
      // V4: Update indexer_v4 sync state
      await supabase.from('sync_state').upsert({ id: 'indexer_v4', last_processed_block: Number(lastBlock) });
    }
  };

  // 1. Backfill Missed Blocks
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
  // 2. Real-time Monitoring
  publicClient.watchEvent({ address: ESCROW_ADDRESS as `0x${string}`, onLogs: handleLogs });
}

async function processLog(log: any) {
  const { eventName, args, blockNumber, transactionHash: txHash } = log;
  const mId = args.matchId ? getDbMatchId(args.matchId) : null;

  logger.info({ eventName, txHash, mId }, 'Processing log details');

  if (eventName === 'MatchCreated') {
    const { error } = await supabase.from('matches').upsert({
      match_id: mId,
      players: [args.creator.toLowerCase()],
      stake_wei: args.stake.toString(),
      game_logic: args.logicId.toLowerCase(),
      max_players: args.maxPlayers,
      max_rounds: args.maxRounds, // V4: maxRounds (was winsRequired)
      status: 'OPEN',
      phase: 'COMMIT',
      current_round: 1,
      wins: Array(args.maxPlayers).fill(0),
      is_fise: true
    });
    if (error) logger.error({ mId, error }, 'Failed to insert MatchCreated');
    else logger.info({ mId }, 'Successfully inserted MatchCreated');

  } else if (eventName === 'PlayerJoined') {
    // V4: Renamed from MatchJoined
    // V4: Use MatchActivated for status change, simpler logic here
    try {
      const playerLower = args.player.toLowerCase();

      // Fetch current match state
      const { data: match, error: fetchError } = await supabase.from('matches').select('players').eq('match_id', mId).maybeSingle();
      if (fetchError) throw fetchError;

      if (match) {
        // Prevent duplicates
        if (match.players?.includes(playerLower)) {
          logger.info({ mId, player: playerLower }, 'PlayerJoined: Player already in match, skipping');
          return;
        }
        const updatedPlayers = [...(match.players || []), playerLower];

        // V4: Don't set ACTIVE here - wait for MatchActivated event
        const { error } = await supabase.from('matches').update({
          players: updatedPlayers
        }).eq('match_id', mId);

        if (error) logger.error({ mId, error }, 'Failed to update PlayerJoined');
        else logger.info({ mId, player: playerLower }, 'Successfully updated PlayerJoined');
      } else if (mId) {
        logger.warn({ mId }, 'PlayerJoined: Match not found in DB, attempting to fetch from chain...');
        await ensureMatchExists(mId, BigInt(args.matchId));
      } else {
        logger.error('PlayerJoined: mId is null');
      }
    } catch (err: any) {
      logger.error({ mId, err: err.message }, 'Error processing PlayerJoined');
    }

  } else if (eventName === 'MatchActivated') {
    // V4: New event - set status to ACTIVE
    await supabase.from('matches').update({
      status: 'ACTIVE'
    }).eq('match_id', mId);
    logger.info({ mId }, 'Match status updated to ACTIVE');

  } else if (eventName === 'MoveCommitted') {
    // Get player index from match
    const { data: match } = await supabase.from('matches').select('players').eq('match_id', mId).single();
    const playerIndex = match?.players?.indexOf(args.player.toLowerCase()) ?? 0;

    await supabase.from('rounds').upsert({
      match_id: mId,
      round_number: args.round,
      player_address: args.player.toLowerCase(),
      player_index: playerIndex,
      revealed: false,
      commit_tx_hash: txHash
    }, { onConflict: 'match_id,round_number,player_address' });

    // V4: Phase managed by contract, but we can track commitment progress
    logger.info({ mId, round: args.round, player: args.player.toLowerCase() }, 'MoveCommitted recorded');

  } else if (eventName === 'MoveRevealed') {
    const { data: match } = await supabase.from('matches').select('players').eq('match_id', mId).single();
    const playerIndex = match?.players?.indexOf(args.player.toLowerCase()) ?? 0;

    // V4: Fetch salt from roundCommits view (not getRoundStatus)
    let salt = null;
    try {
      const roundCommit = await publicClient.readContract({
        address: ESCROW_ADDRESS as `0x${string}`,
        abi: POKER_ENGINE_ABI,
        functionName: 'roundCommits',
        args: [BigInt(args.matchId), args.round, args.player]
      }) as any;
      salt = roundCommit.salt;
    } catch (err: any) {
      logger.warn({ mId, player: args.player.toLowerCase(), err: err.message }, 'Failed to fetch salt from roundCommits');
    }

    // V4: args.move is bytes32 (hex string), not uint8
    const { error: upsertError } = await supabase.from('rounds').upsert({
      match_id: mId,
      round_number: args.round,
      player_address: args.player.toLowerCase(),
      player_index: playerIndex,
      move: args.move, // V4: bytes32 (hex string)
      salt: salt,
      revealed: true,
      reveal_tx_hash: txHash
    }, { onConflict: 'match_id,round_number,player_address' });

    if (upsertError) {
      logger.error({ mId, error: upsertError }, 'MoveRevealed upsert FAILED');
    } else {
      logger.info({ mId, round: args.round, player: args.player.toLowerCase(), move: args.move, hasSalt: !!salt }, 'MoveRevealed recorded');

      // Update state_description when everyone has revealed
      const { data: allRounds } = await supabase.from('rounds').select('revealed')
        .match({ match_id: mId, round_number: args.round });

      const revealCount = allRounds?.filter((r: any) => r.revealed).length || 0;

      if (revealCount >= (match?.players?.length || 2)) {
        await supabase.from('matches').update({
          state_description: "All players revealed. Processing resolution..."
        }).eq('match_id', mId);
        logger.info({ mId }, 'Match state_description updated to REVEALED');
      }
    }

  } else if (eventName === 'RoundResolved') {
    // WINNER MAPPING (V4):
    // 0 (Player A) -> 1
    // 1 (Player B) -> 2
    // 255 (Draw)   -> 0
    let dbWinner = 0;
    if (args.winnerIndex === 0) dbWinner = 1;
    else if (args.winnerIndex === 1) dbWinner = 2;
    else dbWinner = 0; // Draw or fallback

    await supabase.from('rounds').update({
      winner: dbWinner
    }).match({ match_id: mId, round_number: args.round });

    // Refresh match scores and full state
    const matchData = await publicClient.readContract({
      address: ESCROW_ADDRESS as `0x${string}`,
      abi: POKER_ENGINE_ABI,
      functionName: 'getMatch',
      args: [BigInt(args.matchId)]
    }) as any;

    // V4: Get phase from getPokerState
    let pokerState;
    try {
      pokerState = await publicClient.readContract({
        address: ESCROW_ADDRESS as `0x${string}`,
        abi: POKER_ENGINE_ABI,
        functionName: 'getPokerState',
        args: [BigInt(args.matchId)]
      }) as any;
    } catch (err) {
      pokerState = { phase: 0 };
    }

    const phaseMap = ['COMMIT', 'BET', 'REVEAL']; // V4: 3 phases

    await supabase.from('matches').update({
      wins: Array.from(matchData.wins).map(w => Number(w)),
      current_round: Number(matchData.currentRound),
      total_pot: matchData.totalPot.toString(),
      draw_counter: matchData.drawCounter,
      phase: phaseMap[pokerState.phase] || 'COMMIT'
    }).eq('match_id', mId);

  } else if (eventName === 'MatchSettled') {
    // V4: MatchSettled has winnerIndices (array), not single winner
    // Get primary winner (first in array)
    const matchData = await publicClient.readContract({
      address: ESCROW_ADDRESS as `0x${string}`,
      abi: POKER_ENGINE_ABI,
      functionName: 'getMatch',
      args: [BigInt(args.matchId)]
    }) as any;

    const primaryWinner = args.winnerIndices && args.winnerIndices.length > 0
      ? matchData.players[args.winnerIndices[0]]?.toLowerCase()
      : null;

    await supabase.from('matches').update({
      status: 'SETTLED',
      winner: primaryWinner,
      phase: 'COMPLETE',
      settle_tx_hash: txHash
    }).eq('match_id', mId);

    logger.info({ mId, primaryWinner, winnerIndices: args.winnerIndices }, 'MatchSettled recorded');

  } else if (eventName === 'MatchVoided') {
    await supabase.from('matches').update({ status: 'VOIDED', phase: 'COMPLETE' }).eq('match_id', mId);

  } else if (eventName === 'BetPlaced') {
    // V4: New event - refresh total_pot from chain
    const matchData = await publicClient.readContract({
      address: ESCROW_ADDRESS as `0x${string}`,
      abi: POKER_ENGINE_ABI,
      functionName: 'getMatch',
      args: [BigInt(args.matchId)]
    }) as any;

    await supabase.from('matches').update({
      total_pot: matchData.totalPot.toString()
    }).eq('match_id', mId);

    logger.info({ mId, action: args.action, amount: args.amount.toString() }, 'BetPlaced recorded');

  } else if (eventName === 'PlayerFolded') {
    // V4: New event - log fold
    logger.info({ mId, player: args.player.toLowerCase(), playerIndex: args.playerIndex }, 'PlayerFolded recorded');

  } else if (eventName === 'StreetAdvanced') {
    // V4: New event - reset phase to COMMIT for next street
    await supabase.from('matches').update({
      phase: 'COMMIT'
    }).eq('match_id', mId);

    logger.info({ mId, round: args.round, newStreet: args.newStreet }, 'StreetAdvanced recorded');
  }
}

startIndexer().catch(console.error);
