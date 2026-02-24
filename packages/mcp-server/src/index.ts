// --- STDOUT PROTECTION ---
// Redirect all console.log and process.stdout to stderr to prevent breaking JSON-RPC on stdio
console.log = console.error;
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = ((chunk: any, encoding: any, callback: any) => {
  if (typeof chunk === 'string' && (chunk.startsWith('{') || chunk.startsWith('Content-Length'))) {
    return originalWrite(chunk, encoding, callback);
  }
  return process.stderr.write(chunk, encoding, callback);
}) as any;
// -------------------------

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createClient } from '@supabase/supabase-js';
import { createPublicClient, http, encodeFunctionData, keccak256, encodePacked, createWalletClient, verifyMessage } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import dotenv from 'dotenv';
import * as crypto from 'node:crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import pino from 'pino';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Try loading from root (3 levels up from dist/index.js or src/index.ts)
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), quiet: true } as any);
// Also try 2 levels up in case of different execution context
dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true } as any);
dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true } as any);

const logger = pino({}, process.stderr);

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL),
});

const agentAccount = process.env.AGENT_PRIVATE_KEY 
  ? privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`)
  : null;

const walletClient = agentAccount 
  ? createWalletClient({
      account: agentAccount,
      chain: baseSepolia,
      transport: http(process.env.RPC_URL),
    })
  : null;

const ESCROW_ADDRESS = (process.env.ESCROW_ADDRESS || '0x0000000000000000000000000000000000000000').toLowerCase() as `0x${string}`;
const PRICE_FEED_ADDRESS = '0x4adC67696ba3F238D520607D003F756024f60C77' as `0x${string}`;

const AGGREGATOR_ABI = [
  { name: 'latestRoundData', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: 'roundId', type: 'uint80' }, { name: 'answer', type: 'int256' }, { name: 'startedAt', type: 'uint256' }, { name: 'updatedAt', type: 'uint256' }, { name: 'answeredInRound', type: 'uint80' }] }
] as const;

/**
 * Converts USD amount to Wei using the live Chainlink Price Feed.
 */
async function usdToWei(usdAmount: number): Promise<bigint> {
  const data = await publicClient.readContract({
    address: PRICE_FEED_ADDRESS,
    abi: AGGREGATOR_ABI,
    functionName: 'latestRoundData',
  });
  
  const ethPrice = data[1]; // 8 decimals
  if (ethPrice <= 0n) throw new Error('Invalid price from oracle');

  // Formula: (usdAmount * 1e18 * 1e8) / ethPrice
  // We use 1e18 because usdAmount is a standard number (e.g. 5.00)
  const usdAmountBig = BigInt(Math.floor(usdAmount * 1e8));
  return (usdAmountBig * 1e18) / ethPrice;
}

logger.info({ 
  escrow: ESCROW_ADDRESS, 
  hasSupabase: !!process.env.SUPABASE_URL 
}, 'MCP Server environment check');

function parseMatchId(id: string): { dbId: string, onChainId: bigint } {
  if (id.includes('-')) {
    const parts = id.split('-');
    const rawId = parts[parts.length - 1];
    return { dbId: id, onChainId: BigInt(rawId) };
  }
  return { dbId: `${ESCROW_ADDRESS}-${id}`, onChainId: BigInt(id) };
}

async function getNicknames(addresses: string[]): Promise<Record<string, { nickname: string | null, managerNickname: string | null }>> {
  if (addresses.length === 0) return {};
  const normalized = addresses.map(a => a.toLowerCase());
  
  // Fetch agent profiles and join with manager profiles
  const { data: agents } = await supabase
    .from('agent_profiles')
    .select('address, nickname, manager_profiles(nickname)')
    .in('address', normalized);

  const result: Record<string, { nickname: string | null, managerNickname: string | null }> = {};
  normalized.forEach(addr => result[addr] = { nickname: null, managerNickname: null });
  
  agents?.forEach((a: any) => {
    result[a.address.toLowerCase()] = {
      nickname: a.nickname,
      managerNickname: a.manager_profiles?.nickname || null
    };
  });
  
  return result;
}

async function enrichMatchesWithNicknames(matches: any[]) {
  const addresses = new Set<string>();
  matches.forEach(m => {
    if (m.player_a) addresses.add(m.player_a);
    if (m.player_b) addresses.add(m.player_b);
    if (m.winner && m.winner.startsWith('0x')) addresses.add(m.winner);
  });
  
  const nicknames = await getNicknames(Array.from(addresses));
  
  return matches.map(m => ({
    ...m,
    player_a_nickname: nicknames[m.player_a.toLowerCase()]?.nickname,
    player_a_manager: nicknames[m.player_a.toLowerCase()]?.managerNickname,
    player_b_nickname: m.player_b ? nicknames[m.player_b.toLowerCase()]?.nickname : null,
    player_b_manager: m.player_b ? nicknames[m.player_b.toLowerCase()]?.managerNickname : null,
  }));
}

const ESCROW_ABI = [
  { name: 'createMatch', type: 'function', stateMutability: 'payable', inputs: [{ name: '_stake', type: 'uint256' }, { name: '_gameLogic', type: 'address' }], outputs: [] },
  { name: 'joinMatch', type: 'function', stateMutability: 'payable', inputs: [{ name: '_matchId', type: 'uint256' }], outputs: [] },
  { name: 'commitMove', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_matchId', type: 'uint256' }, { name: '_commitHash', type: 'bytes32' }], outputs: [] },
  { name: 'revealMove', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_matchId', type: 'uint256' }, { name: '_move', type: 'uint8' }, { name: '_salt', type: 'bytes32' }], outputs: [] },
  { name: 'claimTimeout', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_matchId', type: 'uint256' }], outputs: [] },
  { name: 'mutualTimeout', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_matchId', type: 'uint256' }], outputs: [] },
  { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { name: 'approveGameLogic', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_logic', type: 'address' }, { name: '_approved', type: 'bool' }], outputs: [] },
] as const;

const LOGIC_ABI = [
  { name: 'gameType', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'moveName', type: 'function', stateMutability: 'pure', inputs: [{ name: 'move', type: 'uint8' }], outputs: [{ type: 'string' }] },
] as const;

export const TOOLS = [
  { name: 'get_arena_stats', description: 'Returns global stats.', inputSchema: { type: 'object' } },
  { name: 'validate_wallet_ready', description: 'Checks ETH balance.', inputSchema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] } },
  { name: 'find_matches', description: 'Finds open matches.', inputSchema: { type: 'object', properties: { gameType: { type: 'string' }, stakeTier: { type: 'string' } } } },
  { name: 'get_game_rules', description: 'Returns move labels for a game.', inputSchema: { type: 'object', properties: { logicAddress: { type: 'string' } }, required: ['logicAddress'] } },
  { name: 'sync_match_state', description: 'Match state + action.', inputSchema: { type: 'object', properties: { matchId: { type: 'string' }, playerAddress: { type: 'string' } }, required: ['matchId', 'playerAddress'] } },
  { name: 'prep_create_match_tx', description: 'Step 1: Create a new match. Minimum stake is $5.00 USD worth of ETH.', inputSchema: { type: 'object', properties: { stakeETH: { type: 'number', description: 'Amount in ETH, e.g. 0.01' }, gameLogicAddress: { type: 'string' }, playerAddress: { type: 'string' } }, required: ['stakeETH', 'gameLogicAddress', 'playerAddress'] } },
  { name: 'prep_join_match_tx', description: 'Step 2: Join an existing OPEN match. Call this before commitMove if you are Player B.', inputSchema: { type: 'object', properties: { matchId: { type: 'string' }, playerAddress: { type: 'string' } }, required: ['matchId', 'playerAddress'] } },
  { name: 'prep_commit_tx', description: 'Step 3: Submit a hashed secret move to an ACTIVE match. Match status must be ACTIVE.', inputSchema: { type: 'object', properties: { matchId: { type: 'string' }, playerAddress: { type: 'string' }, move: { type: 'number' } }, required: ['matchId', 'playerAddress', 'move'] } },
  { name: 'prep_reveal_tx', description: 'Step 4: Reveal your move after both players have committed. Use the salt from your persistence layer.', inputSchema: { type: 'object', properties: { matchId: { type: 'string' }, move: { type: 'number' }, salt: { type: 'string' }, playerAddress: { type: 'string' } }, required: ['matchId', 'move', 'salt', 'playerAddress'] } },
  { name: 'prep_claim_timeout_tx', description: 'Claim win on timeout.', inputSchema: { type: 'object', properties: { matchId: { type: 'string' }, playerAddress: { type: 'string' } }, required: ['matchId', 'playerAddress'] } },
  { name: 'prep_mutual_timeout_tx', description: 'Mutual refund if both fail.', inputSchema: { type: 'object', properties: { matchId: { type: 'string' }, playerAddress: { type: 'string' } }, required: ['matchId', 'playerAddress'] } },
  { name: 'prep_withdraw_tx', description: 'Withdraw pending funds from pull-payment ledger.', inputSchema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] } },
  { name: 'whitelist_game_logic', description: 'Admin only: Whitelist a new IGameLogic contract.', inputSchema: { type: 'object', properties: { logicAddress: { type: 'string' }, approved: { type: 'boolean' }, adminAddress: { type: 'string' } }, required: ['logicAddress', 'approved', 'adminAddress'] } },
  { name: 'get_unrevealed_commits', description: 'Finds matches where you have committed but not yet revealed. Use this after a reboot.', inputSchema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] } },
  { name: 'get_reveal_payload', description: 'Simplifies reveal by identifying the pending round.', inputSchema: { type: 'object', properties: { matchId: { type: 'string' }, playerAddress: { type: 'string' } }, required: ['matchId', 'playerAddress'] } },
  { name: 'get_opponent_intel', description: 'Opponent patterns.', inputSchema: { type: 'object', properties: { opponentAddress: { type: 'string' } }, required: ['opponentAddress'] } },
  { name: 'get_player_stats', description: 'Get detailed stats for any player address.', inputSchema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] } },
  { name: 'get_my_address', description: 'Returns the public address of the configured AGENT_PRIVATE_KEY. Call this to know who YOU are.', inputSchema: { type: 'object' } },
  { name: 'update_agent_nickname', description: 'Update YOUR nickname in the arena. If no address/signature provided, uses server configured key.', inputSchema: { type: 'object', properties: { nickname: { type: 'string' }, address: { type: 'string' }, signature: { type: 'string' } }, required: ['nickname'] } },
  { name: 'get_leaderboard', description: 'Returns the top 10 agents by ELO rating.', inputSchema: { type: 'object' } },
  { name: 'execute_transaction', description: 'Autonomous Step: Signs and broadcasts a transaction prepared by any prep_ tool using the local AGENT_PRIVATE_KEY. Only use this if you want to act autonomously.', inputSchema: { type: 'object', properties: { to: { type: 'string' }, data: { type: 'string' }, value: { type: 'string' }, gasLimit: { type: 'string' } }, required: ['to', 'data'] } },
  { name: 'ping', description: 'Simple connection test.', inputSchema: { type: 'object', properties: { message: { type: 'string' } } } },
];

async function prepTxWithBuffer(functionName: string, args: any[], value: bigint = 0n, account?: `0x${string}`) {
  const gas = await publicClient.estimateContractGas({ 
    address: ESCROW_ADDRESS, 
    abi: ESCROW_ABI, 
    functionName, 
    args, 
    value,
    account 
  } as any);
  const data = encodeFunctionData({ abi: ESCROW_ABI, functionName, args } as any);
  return { to: ESCROW_ADDRESS, data, value: value.toString(), gasLimit: ((gas * 120n) / 100n).toString() };
}

export async function handleToolCall(name: string, args: any) {
  logger.info({ tool: name, args }, 'Handling MCP tool call');
  if (name === 'get_arena_stats') {
    const { data: matches } = await supabase.from('matches').select('stake_wei').eq('status', 'ACTIVE');
    const tvl = (matches || []).reduce((acc: bigint, m: any) => acc + BigInt(m.stake_wei), BigInt(0)).toString();
    return { activeMatches: (matches || []).length, tvlWei: tvl };
  }

  if (name === 'get_game_rules') {
    const { logicAddress } = (args || {}) as { logicAddress: `0x${string}` };
    const gameType = await publicClient.readContract({ address: logicAddress, abi: LOGIC_ABI, functionName: 'gameType' });
    const moveLabels: Record<number, string> = {};
    for (let i = 0; i <= 10; i++) {
      try {
        const label = await publicClient.readContract({ address: logicAddress, abi: LOGIC_ABI, functionName: 'moveName', args: [i] });
        if (label === "UNKNOWN") continue; // Some games might start at 1
        moveLabels[i] = label;
      } catch { continue; }
    }
    return { gameType, moveLabels };
  }

  if (name === 'validate_wallet_ready') {
    const { address } = (args || {}) as { address: `0x${string}` };
    const balance = await publicClient.getBalance({ address });
    return { address, balanceWei: balance.toString(), ready: balance > 0n };
  }

  if (name === 'find_matches') {
    const { gameType, stakeTier } = (args || {}) as { gameType?: string; stakeTier?: string };
    let query = supabase.from('matches').select('*').eq('status', 'OPEN');
    
    if (gameType) {
      const gt = gameType.toUpperCase();
      let logicAddr = gameType.toLowerCase();
      
      // Resolve names to addresses from env
      if (gt === 'RPS') {
        logicAddr = (process.env.RPS_LOGIC_ADDRESS || '').toLowerCase();
      } else if (gt === 'SIMPLE_DICE' || gt === 'DICE') {
        logicAddr = (process.env.DICE_LOGIC_ADDRESS || '').toLowerCase();
      }
      
      query = query.eq('game_logic', logicAddr);
    }
    
    if (stakeTier) query = query.eq('stake_wei', stakeTier);
    const { data: matches } = await query;
    if (!matches) return [];
    
    return await enrichMatchesWithNicknames(matches);
  }

  if (name === 'sync_match_state') {
    const { matchId, playerAddress } = (args || {}) as { matchId: string; playerAddress: string };
    const { dbId } = parseMatchId(matchId);
    const { data: match } = await supabase.from('matches').select('*').eq('match_id', dbId).single();
    if (!match) throw new Error('Match not found');
    const { data: rounds } = await supabase.from('rounds').select('*').match({ match_id: dbId, round_number: match.current_round });
    
    const now = new Date();
    let nextAction = "WAIT";
    const playerRound = rounds?.find((r: any) => r.player_address.toLowerCase() === playerAddress.toLowerCase());
    const deadline = match.phase === 'COMMIT' ? new Date(match.commit_deadline) : new Date(match.reveal_deadline);
    const hasPassedDeadline = now > deadline;

    if (match.status === 'OPEN') {
      nextAction = match.player_a.toLowerCase() === playerAddress.toLowerCase() ? "WAIT_FOR_OPPONENT" : "JOIN_MATCH";
    } else if (match.status === 'ACTIVE') {
      if (hasPassedDeadline) {
        if (!playerRound || (match.phase === 'REVEAL' && !playerRound.revealed)) nextAction = "MUTUAL_TIMEOUT";
        else nextAction = "CLAIM_TIMEOUT";
      } else {
        if (match.phase === 'COMMIT') nextAction = playerRound ? "WAIT_FOR_OPPONENT_COMMIT" : "COMMIT_MOVE";
        else nextAction = playerRound?.revealed ? "WAIT_FOR_OPPONENT_REVEAL" : "REVEAL_MOVE";
      }
    } else nextAction = "MATCH_OVER";

    return { 
      match: {
        ...match,
        wins_a: match.wins_a,
        wins_b: match.wins_b,
        winner: match.winner
      }, 
      rounds, 
      recommendedNextAction: nextAction 
    };
  }

  if (name === 'get_reveal_payload') {
    const { matchId, playerAddress } = (args || {}) as { matchId: string; playerAddress: string };
    const { dbId } = parseMatchId(matchId);
    const { data: match } = await supabase.from('matches').select('current_round').eq('match_id', dbId).single();
    if (!match) throw new Error('Match not found');
    return { matchId: dbId, round: match.current_round, playerAddress, instructions: "Look up this matchId and round in your local salts.json to find the salt and move." };
  }

  if (name === 'get_unrevealed_commits') {
    const { address } = (args || {}) as { address: string };
    const { data } = await supabase.from('rounds').select('match_id, round_number').match({ player_address: address.toLowerCase(), revealed: false });
    return data || [];
  }

  if (name === 'prep_create_match_tx') {
    const { stakeETH, gameLogicAddress, playerAddress } = (args || {}) as { stakeETH: number; gameLogicAddress: string; playerAddress: string };
    const stakeWei = BigInt(Math.floor(stakeETH * 1e18));
    
    // Verify $5 Minimum Floor
    const minWei = await usdToWei(5);
    if (stakeWei < minWei) {
      throw new Error(`Stake too low. Minimum required: $5.00 USD (~${(Number(minWei) / 1e18).toFixed(6)} ETH)`);
    }

    return await prepTxWithBuffer('createMatch', [stakeWei, gameLogicAddress as `0x${string}`], stakeWei, playerAddress as `0x${string}`);
  }

  if (name === 'prep_commit_tx') {
    const { matchId, playerAddress, move } = (args || {}) as { matchId: string; playerAddress: string; move: number };
    const { dbId, onChainId } = parseMatchId(matchId);
    const { data: match } = await supabase.from('matches').select('current_round').eq('match_id', dbId).single();
    if (!match) throw new Error('Match not found');
    const salt = `0x${crypto.randomBytes(32).toString('hex')}` as `0x${string}`;
    const hash = keccak256(encodePacked(['uint256', 'uint8', 'address', 'uint8', 'bytes32'], [onChainId, match.current_round, playerAddress as `0x${string}`, move, salt]));
    const tx = await prepTxWithBuffer('commitMove', [onChainId, hash], 0n, playerAddress as `0x${string}`);
    return { ...tx, salt, move, matchId: dbId, persistence_required: true };
  }

  if (name === 'prep_join_match_tx') {
    const { matchId, playerAddress } = (args || {}) as { matchId: string; playerAddress: string };
    const { dbId, onChainId } = parseMatchId(matchId);
    const { data: match } = await supabase.from('matches').select('stake_wei, status').eq('match_id', dbId).single();
    if (!match) throw new Error('Match not found');
    // If it's already ACTIVE, it means Player B is already in.
    if (match.status === 'ACTIVE') throw new Error('Match is already active/joined');
    if (match.status !== 'OPEN') throw new Error(`Match is not in a joinable state (Status: ${match.status})`);
    return await prepTxWithBuffer('joinMatch', [onChainId], BigInt(match.stake_wei), playerAddress as `0x${string}`);
  }

  if (name === 'prep_reveal_tx') {
    const { matchId, move, salt, playerAddress } = (args || {}) as { matchId: string; move: number; salt: `0x${string}`; playerAddress: string };
    const { onChainId } = parseMatchId(matchId);
    return await prepTxWithBuffer('revealMove', [onChainId, move, salt], 0n, playerAddress as `0x${string}`);
  }

  if (name === 'prep_claim_timeout_tx') {
    const { matchId, playerAddress } = (args || {}) as { matchId: string; playerAddress: string };
    const { onChainId } = parseMatchId(matchId);
    return await prepTxWithBuffer('claimTimeout', [onChainId], 0n, playerAddress as `0x${string}`);
  }

  if (name === 'prep_mutual_timeout_tx') {
    const { matchId, playerAddress } = (args || {}) as { matchId: string; playerAddress: string };
    const { onChainId } = parseMatchId(matchId);
    return await prepTxWithBuffer('mutualTimeout', [onChainId], 0n, playerAddress as `0x${string}`);
  }

  if (name === 'prep_withdraw_tx') {
    const { address } = (args || {}) as { address: string };
    return await prepTxWithBuffer('withdraw', [], 0n, address as `0x${string}`);
  }

  if (name === 'whitelist_game_logic') {
    const { logicAddress, approved, adminAddress } = (args || {}) as { logicAddress: `0x${string}`; approved: boolean; adminAddress: string };
    return await prepTxWithBuffer('approveGameLogic', [logicAddress, approved], 0n, adminAddress as `0x${string}`);
  }

  if (name === 'get_opponent_intel') {
    const { opponentAddress } = (args || {}) as { opponentAddress: string };
    const addrLower = opponentAddress.toLowerCase();
    const { data: profile } = await supabase.from('agent_profiles').select('*').eq('address', addrLower).single();
    const { data: rounds } = await supabase.from('rounds').select('move, winner, player_index').eq('player_address', addrLower);
    return { profile, totalRoundsPlayed: rounds?.length || 0, winCount: rounds?.filter((r: any) => r.winner === r.player_index).length || 0 };
  }

  if (name === 'get_player_stats') {
    const { address } = (args || {}) as { address: string };
    const addrLower = address.toLowerCase();
    const { data: profile } = await supabase
      .from('agent_profiles')
      .select('*, manager_profiles(nickname)')
      .eq('address', addrLower)
      .single();
      
    if (!profile) return { error: 'Player not found in arena' };
    
    // Get recent matches
    const { data: matches } = await supabase
      .from('matches')
      .select('match_id, player_a, player_b, status, winner, wins_a, wins_b, created_at')
      .or(`player_a.eq.${addrLower},player_b.eq.${addrLower}`)
      .order('created_at', { ascending: false })
      .limit(5);

    const enrichedMatches = matches ? await enrichMatchesWithNicknames(matches) : [];

    return { 
      profile: {
        ...profile,
        manager_nickname: (profile as any).manager_profiles?.nickname
      }, 
      recentMatches: enrichedMatches 
    };
  }

  if (name === 'get_leaderboard') {
    const { data } = await supabase
      .from('agent_profiles')
      .select('*, manager_profiles(nickname)')
      .order('elo', { ascending: false })
      .limit(10);
      
    return data?.map((a: any) => ({
      ...a,
      manager_nickname: a.manager_profiles?.nickname
    })) || [];
  }

  if (name === 'get_my_address') {
    if (!agentAccount) throw new Error('AGENT_PRIVATE_KEY not configured on server');
    return { address: agentAccount.address };
  }

  if (name === 'update_agent_nickname') {
    const { nickname, address, signature } = (args || {}) as { nickname: string; address?: `0x${string}`; signature?: `0x${string}` };
    
    let targetAddress: string;
    
    if (address && signature) {
      // Verify signature of the nickname to prove ownership of the address
      const isValid = await verifyMessage({ address, message: nickname, signature });
      if (!isValid) throw new Error('Invalid signature for nickname update');
      targetAddress = address.toLowerCase();
    } else {
      if (!agentAccount) throw new Error('AGENT_PRIVATE_KEY not configured on server and no signature provided');
      targetAddress = agentAccount.address.toLowerCase();
    }
    
    const { error } = await supabase
      .from('agent_profiles')
      .upsert({ 
        address: targetAddress, 
        nickname, 
        last_active: new Date().toISOString() 
      }, { onConflict: 'address' });

    if (error) throw new Error(`Failed to update nickname: ${error.message}`);
    return { success: true, nickname, address: targetAddress };
  }

  if (name === 'execute_transaction') {
    if (!walletClient || !agentAccount) throw new Error('AGENT_PRIVATE_KEY not configured on server');
    const { to, data, value, gasLimit } = (args || {}) as { to: `0x${string}`; data: `0x${string}`; value?: string; gasLimit?: string };
    
    logger.info({ to, value, gasLimit }, 'Executing autonomous transaction');
    
    const hash = await walletClient.sendTransaction({
      to,
      data,
      value: value ? BigInt(value) : 0n,
      gas: gasLimit ? BigInt(gasLimit) : undefined,
    });

    logger.info({ hash }, 'Transaction broadcasted');
    return { hash, status: 'submitted', explorerUrl: `https://sepolia.basescan.org/tx/${hash}` };
  }

  if (name === 'ping') {
    const { message } = (args || {}) as { message?: string };
    return { status: 'pong', message: message || 'No message provided', timestamp: new Date().toISOString() };
  }

  throw new Error(`Tool not found: ${name}`);
}

export const server = new Server({ name: 'botbyte-protocol', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const result = await handleToolCall(request.params.name, request.params.arguments);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error: any) {
    return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
  }
});

async function main() {
  const isDirectRun = process.argv[1] && (
    process.argv[1].endsWith('index.js') || 
    process.argv[1].endsWith('mcp-server/dist/index.js') ||
    process.argv[1].endsWith('mcp-server/src/index.ts')
  );

  if (isDirectRun) {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('BOTBYTE MCP Server running on stdio');
  }
}

main().catch(console.error);
