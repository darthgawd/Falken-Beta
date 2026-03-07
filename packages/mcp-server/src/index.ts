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
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import cors from 'cors';

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
const LOGIC_REGISTRY_ADDRESS = (process.env.LOGIC_REGISTRY_ADDRESS || '0x0000000000000000000000000000000000000000').toLowerCase() as `0x${string}`;
const PRICE_FEED_ADDRESS = '0x4adC67696ba3F238D520607D003F756024f60C77' as `0x${string}`;
const MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY || 'default_key_32_chars_for_dev_only_!!';

/**
 * Encrypts a private key using AES-256-GCM.
 */
function encryptKey(privateKey: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(MASTER_ENCRYPTION_KEY.slice(0, 32)), iv);
  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

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
  return (usdAmountBig * 10n**18n) / ethPrice;
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
    if (m.players && Array.isArray(m.players)) {
      m.players.forEach((p: string) => addresses.add(p));
    }
    if (m.winner && m.winner.startsWith('0x')) addresses.add(m.winner);
  });
  
  const nicknames = await getNicknames(Array.from(addresses));
  
  return matches.map(m => {
    const playerNicknames = (m.players || []).map((p: string) => nicknames[p.toLowerCase()]?.nickname || p.slice(0,6));
    return {
      ...m,
      player_a_nickname: playerNicknames[0] || 'Unknown',
      player_b_nickname: playerNicknames[1] || null,
      player_nicknames: playerNicknames,
      player_count: (m.players || []).length
    };
  });
}

const ESCROW_ABI = [
  { name: 'createMatch', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'stake', type: 'uint256' }, { name: 'logicId', type: 'bytes32' }, { name: 'maxPlayers', type: 'uint8' }, { name: 'winsRequired', type: 'uint8' }], outputs: [] },
  { name: 'joinMatch', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'matchId', type: 'uint256' }], outputs: [] },
  { name: 'commitMove', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_matchId', type: 'uint256' }, { name: '_commitHash', type: 'bytes32' }], outputs: [] },
  { name: 'revealMove', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_matchId', type: 'uint256' }, { name: '_move', type: 'uint8' }, { name: '_salt', type: 'bytes32' }], outputs: [] },
  { name: 'claimTimeout', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_matchId', type: 'uint256' }], outputs: [] },
  { name: 'mutualTimeout', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_matchId', type: 'uint256' }], outputs: [] },
  { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
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
        { name: 'currentRound', type: 'uint8' },
        { name: 'wins', type: 'uint8[]' },
        { name: 'drawCounter', type: 'uint8' },
        { name: 'phase', type: 'uint8' },
        { name: 'status', type: 'uint8' },
        { name: 'commitDeadline', type: 'uint256' },
        { name: 'revealDeadline', type: 'uint256' },
        { name: 'winner', type: 'address' }
      ]
    }]
  },
  { name: 'getRoundStatus', type: 'function', stateMutability: 'view', inputs: [{ name: 'matchId', type: 'uint256' }, { name: 'round', type: 'uint8' }, { name: 'player', type: 'address' }], outputs: [{ name: 'commitHash', type: 'bytes32' }, { name: 'revealed', type: 'bool' }] },
] as const;

const LOGIC_REGISTRY_ABI = [
  { name: 'getRegistryCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'allLogicIds', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [{ type: 'bytes32', internalType: 'bytes32[]' }] },
  { name: 'registry', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'bytes32' }], outputs: [{ name: 'ipfsCid', type: 'string' }, { name: 'developer', type: 'address' }, { name: 'isVerified', type: 'bool' }, { name: 'createdAt', type: 'uint256' }, { name: 'totalVolume', type: 'uint256' }] },
] as const;

export const TOOLS = [
  { name: 'get_arena_stats', description: 'Returns global stats.', inputSchema: { type: 'object' } },
  { name: 'validate_wallet_ready', description: 'Checks ETH balance.', inputSchema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] } },
  { name: 'find_matches', description: 'Finds open matches.', inputSchema: { type: 'object', properties: { gameType: { type: 'string' }, stakeTier: { type: 'string' } } } },
  { name: 'get_game_rules', description: 'Returns move labels for a game.', inputSchema: { type: 'object', properties: { logicAddress: { type: 'string' } }, required: ['logicAddress'] } },
  { name: 'sync_match_state', description: 'Match state + action.', inputSchema: { type: 'object', properties: { matchId: { type: 'string' }, playerAddress: { type: 'string' } }, required: ['matchId', 'playerAddress'] } },
  { name: 'prep_create_match_tx', description: 'Step 1: Create a new match.', inputSchema: { type: 'object', properties: { stakeUSDC: { type: 'number', description: 'Amount in USDC, e.g. 1.00' }, gameLogicAddress: { type: 'string' }, playerAddress: { type: 'string' }, maxPlayers: { type: 'number', description: 'Total players needed (default 2)' }, winsRequired: { type: 'number', description: 'Wins needed to win match (default 1)' } }, required: ['stakeUSDC', 'gameLogicAddress', 'playerAddress'] } },
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
  { name: 'list_available_games', description: 'Unified discovery for all games in the arena (Solidity + JavaScript). Returns addresses/CIDs and logic types.', inputSchema: { type: 'object' } },
  { name: 'spawn_hosted_agent', description: 'Step 1 (Factory): Generate a new hosted agent with an encrypted wallet.', inputSchema: { type: 'object', properties: { nickname: { type: 'string' }, archetype: { type: 'string' }, llmTier: { type: 'string' }, managerAddress: { type: 'string' } }, required: ['nickname', 'archetype', 'llmTier', 'managerAddress'] } },
  { name: 'get_agent_directives', description: 'Checks for manual commands from the manager (e.g. FOLD, STAY, AGGRESSIVE).', inputSchema: { type: 'object', properties: { agentAddress: { type: 'string' } }, required: ['agentAddress'] } },
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
    const tvl = (matches || []).reduce((acc: bigint, m: any) => acc + BigInt(m.stake_wei), BigInt(0));
    const ethTvl = (Number(tvl) / 1e18).toFixed(4);
    
    return `### 🏟️ Falken Arena Stats\n- **Active Matches:** ${(matches || []).length}\n- **Total Value Locked (TVL):** ${ethTvl} ETH`;
  }

  if (name === 'get_game_rules') {
    const { logicAddress } = (args || {}) as { logicAddress: string };
    
    // Handle FISE (JavaScript) Games
    const pokerLogicIdV4 = '0x4173a4e2e54727578fd50a3f1e721827c4c97c3a2824ca469c0ec730d4264b43';
    const pokerAliases = [pokerLogicIdV4, '0xec63afc7c67678adbe7a60af04d49031878d1e78eff9758b1b79edeb7546dfdf', '0x5f164061c4cbb981098161539f7f691650e0c245be54ade84ea5b57496955846'];

    if (pokerAliases.includes(logicAddress.toLowerCase())) {
      return {
        gameType: 'POKER_BLITZ',
        rules: '5-Card Draw. 1 Swap phase.',
        moveLabels: {
          '99': 'STAY (Keep Hand)',
          '0-4': 'Indices to discard (e.g. "012" discards first 3 cards)',
          '01234': 'DISCARD ALL'
        }
      };
    }

    return { error: 'Unknown FISE logic ID. Only JavaScript-based games are supported in the Falken Arena.' };
  }

  if (name === 'validate_wallet_ready') {
    const { address } = (args || {}) as { address: `0x${string}` };
    const ethBalance = await publicClient.getBalance({ address });
    const usdcBalance = await publicClient.readContract({
      address: process.env.USDC_ADDRESS as `0x${string}`,
      abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] }],
      functionName: 'balanceOf',
      args: [address]
    });

    const ethFormatted = (Number(ethBalance) / 1e18).toFixed(4);
    const usdcFormatted = (Number(usdcBalance) / 1e6).toFixed(2);
    const isReady = ethBalance > 0n && usdcBalance > 0n;
    
    return `### 👛 Wallet Check: ${address.slice(0,8)}...\n- **ETH (Gas):** ${ethFormatted} ETH\n- **USDC (Stakes):** ${usdcFormatted} USDC\n- **Status:** ${isReady ? "✅ Ready for combat" : "❌ Awaiting funds"}`;
  }

  if (name === 'find_matches') {
    const { gameType, stakeTier } = (args || {}) as { gameType?: string; stakeTier?: string };
    let query = supabase.from('matches').select('*').eq('status', 'OPEN').eq('is_fise', true);
    
    if (gameType) {
      query = query.eq('game_logic', gameType.toLowerCase());
    }
    
    if (stakeTier) query = query.eq('stake_wei', stakeTier);
    const { data: matches } = await query;
    if (!matches || matches.length === 0) return "No open matches found. Create one using `prep_create_match_tx`.";
    
    const enriched = await enrichMatchesWithNicknames(matches);
    let md = "### ⚔️ Open Matches\n\n";
    enriched.forEach((m: any) => {
      const stakeUsdc = (Number(m.stake_wei) / 1e6).toFixed(2);
      const playerList = m.player_nicknames?.join(', ') || 'Waiting for players';
      const playerCount = `${m.player_count || 0}/${m.max_players || 2}`;
      md += `- **Match ${m.match_id.split('-').pop()}** | ${playerList} | ${stakeUsdc} USDC | ${playerCount} players | [Join Match]\n`;
    });
    return md;
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
      const isCreator = match.players && match.players[0] && match.players[0].toLowerCase() === playerAddress.toLowerCase();
      nextAction = isCreator ? "WAIT_FOR_OPPONENT" : "JOIN_MATCH";
    } else if (match.status === 'ACTIVE') {
      if (hasPassedDeadline) {
        if (!playerRound || (match.phase === 'REVEAL' && !playerRound.revealed)) nextAction = "MUTUAL_TIMEOUT";
        else nextAction = "CLAIM_TIMEOUT";
      } else {
        if (match.phase === 'COMMIT') nextAction = playerRound ? "WAIT_FOR_OPPONENT_COMMIT" : "COMMIT_MOVE";
        else nextAction = playerRound?.revealed ? "WAIT_FOR_OPPONENT_REVEAL" : "REVEAL_MOVE";
      }
    } else nextAction = "MATCH_OVER";

    const stakeEth = (Number(match.stake_wei) / 1e6).toFixed(2);
    let md = `### 🎮 Match **${match.match_id.split('-').pop()}** Status\n`;
    md += `- **Status:** \`${match.status}\` | **Phase:** \`${match.phase}\`\n`;
    
    if (match.wins && Array.isArray(match.wins)) {
      md += `- **Score:** ${match.wins.join(' - ')}\n`;
    }
    
    // POKER HAND CALCULATION (Restoring the "Perfect" flow)
    const isPoker = match.game_logic.toLowerCase() === "0x9f803373e9b7dc5edddcb91c5ca2d000c78360e0d53c5d17ee9d0b6037c6358b";
    if (isPoker && match.status === 'ACTIVE' && match.players) {
      const hand = calculatePokerHand(dbId, match.current_round, playerAddress, match.players);
      if (hand) md += `- **Your Hand:** \`${hand}\`\n`;
    }

    md += `- **Stake:** ${stakeEth} USDC\n`;
    md += `- **Recommended Action:** **${nextAction}**\n\n`;

    if (rounds && rounds.length > 0) {
      md += "**Current Round State:**\n";
      rounds.forEach(r => {
        const revealed = r.revealed ? "✅ Revealed" : "🤫 Hidden";
        md += `- ${r.player_address.slice(0,6)}... | ${revealed}\n`;
      });
    }

    // Keep data in JSON for the model to use, but return string for user
    return md;
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
    const { stakeUSDC, stakeETH, gameLogicAddress, playerAddress, maxPlayers, winsRequired } = (args || {}) as { stakeUSDC?: number; stakeETH?: number; gameLogicAddress: string; playerAddress: string; maxPlayers?: number; winsRequired?: number };
    
    // Support both field names for backward compatibility, but prefer stakeUSDC
    const amount = stakeUSDC !== undefined ? stakeUSDC : (stakeETH || 0);
    const stakeWei = BigInt(Math.floor(amount * 1e6)); // USDC 6 decimals
    const players = maxPlayers || 2;
    const wins = winsRequired || 3; // Default to 3 wins for Poker

    return await prepTxWithBuffer('createMatch', [stakeWei, gameLogicAddress as `0x${string}`, players, wins], 0n, playerAddress as `0x${string}`);
  }
  if (name === 'prep_commit_tx') {
    const { matchId, playerAddress, move } = (args || {}) as { matchId: string; playerAddress: string; move: number };
    const { dbId, onChainId } = parseMatchId(matchId);
    const { data: match } = await supabase.from('matches').select('current_round').eq('match_id', dbId).single();
    if (!match) throw new Error('Match not found');
    const salt = `0x${crypto.randomBytes(32).toString('hex')}` as `0x${string}`;
    // Hash MUST match MatchEscrow.sol: keccak256(abi.encodePacked("FALKEN_V1", address(this), _matchId, uint256(m.currentRound), msg.sender, uint256(_move), _salt))
    const escrowAddress = process.env.ESCROW_ADDRESS as `0x${string}`;
    const hash = keccak256(encodePacked(
      ['string', 'address', 'uint256', 'uint256', 'address', 'uint256', 'bytes32'], 
      ["FALKEN_V1", escrowAddress, onChainId, BigInt(match.current_round), playerAddress as `0x${string}`, BigInt(move), salt]
    ));
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
    
    if (!profile) return `### 🕵️ Opponent Intel: ${opponentAddress.slice(0,8)}...\n- **Status:** Unknown / No history.`;

    const total = rounds?.length || 0;
    const wins = rounds?.filter((r: any) => r.winner === r.player_index).length || 0;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0";

    return `### 🕵️ Intel: **${profile.nickname}**\n- **Address:** \`${profile.address}\`\n- **Elo Rating:** ${profile.elo}\n- **Win Rate:** ${winRate}% (${wins}/${total} rounds won)\n- **Last Active:** ${new Date(profile.last_active).toLocaleString()}`;
  }

  if (name === 'get_player_stats') {
    const { address } = (args || {}) as { address: string };
    const addrLower = address.toLowerCase();
    const { data: profile } = await supabase
      .from('agent_profiles')
      .select('*, manager_profiles(nickname)')
      .eq('address', addrLower)
      .single();
      
    if (!profile) return `### 👤 Player Profile\n- **Status:** Address \`${address.slice(0,8)}...\` not found in arena records.`;
    
    // Get recent matches
    const { data: matches } = await supabase
      .from('matches')
      .select('match_id, player_a, player_b, status, winner, wins_a, wins_b, created_at')
      .or(`player_a.eq.${addrLower},player_b.eq.${addrLower}`)
      .order('created_at', { ascending: false })
      .limit(5);

    const manager = (profile as any).manager_profiles?.nickname || "Independent";
    let md = `### 👤 Profile: **${profile.nickname}**\n`;
    md += `- **Manager:** ${manager}\n`;
    md += `- **Elo:** ${profile.elo} | **W/L:** ${profile.wins}W / ${profile.losses}L\n\n`;
    
    if (matches && matches.length > 0) {
      md += "**Last 5 Matches:**\n";
      matches.forEach(m => {
        const isPlayerA = m.player_a.toLowerCase() === addrLower;
        const opponent = isPlayerA ? m.player_b : m.player_a;
        const result = m.status === 'SETTLED' ? (m.winner.toLowerCase() === addrLower ? "✅ WIN" : "❌ LOSS") : "⏳ ACTIVE";
        md += `- ${result} vs \`${opponent?.slice(0,6)}...\` (Score: ${m.wins_a}-${m.wins_b})\n`;
      });
    }

    return md;
  }

  if (name === 'get_leaderboard') {
    const { data } = await supabase
      .from('agent_profiles')
      .select('*, manager_profiles(nickname)')
      .order('elo', { ascending: false })
      .limit(10);
      
    if (!data || data.length === 0) return "No agents found in the arena.";

    let md = "### 🏆 Falken Leaderboard (Top 10)\n\n";
    md += "| Rank | Agent | Elo | Wins | Losses |\n";
    md += "| :--- | :--- | :--- | :--- | :--- |\n";
    
    data.forEach((a: any, i: number) => {
      md += `| ${i + 1} | **${a.nickname}** (${a.address.slice(0,6)}...) | ${a.elo} | ${a.wins} | ${a.losses} |\n`;
    });

    return md;
  }

  if (name === 'list_available_games') {
    const availableGames: any[] = [];
    const ALPHA_WHITELIST = [
      '0x4173a4e2e54727578fd50a3f1e721827c4c97c3a2824ca469c0ec730d4264b43', // Poker Blitz v4
      '0xec63afc7c67678adbe7a60af04d49031878d1e78eff9758b1b79edeb7546dfdf', // Poker Blitz v5
      '0x5f164061c4cbb981098161539f7f691650e0c245be54ade84ea5b57496955846', // Poker Blitz v6
      '0xa00a45cb44b39c3dc91fb7963d2dd65c217ae5b25c20cb216c1f9431900a5d61'  // Poker Blitz (V3 Registry)
    ];

    if (LOGIC_REGISTRY_ADDRESS && LOGIC_REGISTRY_ADDRESS !== '0x0000000000000000000000000000000000000000') {
      try {
        const count = await publicClient.readContract({
          address: LOGIC_REGISTRY_ADDRESS,
          abi: LOGIC_REGISTRY_ABI,
          functionName: 'getRegistryCount',
        });

        for (let i = 0; i < Number(count); i++) {
          const logicId = await publicClient.readContract({
            address: LOGIC_REGISTRY_ADDRESS,
            abi: LOGIC_REGISTRY_ABI,
            functionName: 'allLogicIds',
            args: [BigInt(i)]
          });

          const [ipfsCid, developer, isVerified] = await publicClient.readContract({
            address: LOGIC_REGISTRY_ADDRESS,
            abi: LOGIC_REGISTRY_ABI,
            functionName: 'registry',
            args: [logicId]
          });

          // Try to get CID from Supabase first (may be more up to date or canonical)
          const { data: aliasData } = await supabase.from('logic_aliases').select('alias_name').eq('logic_id', logicId.toLowerCase()).single();
          let finalCID = ipfsCid;
          let gameName = aliasData?.alias_name || 'Community Game';

          if (aliasData) {
            // If we have an alias, try to get the metadata from logic_submissions
            const { data: subData } = await supabase.from('logic_submissions').select('ipfs_cid').eq('game_name', "Poker Blitz (Stable)").single();
            if (subData?.ipfs_cid) finalCID = subData.ipfs_cid;
          }

          // Only return verified games or games in our Alpha Whitelist
          if (isVerified || ALPHA_WHITELIST.includes(logicId.toLowerCase())) {
            if (ALPHA_WHITELIST.includes(logicId.toLowerCase())) gameName = 'POKER_BLITZ';

            availableGames.push({
              id: logicId,
              name: gameName,
              cid: finalCID,
              developer,
              type: 'JAVASCRIPT',
              isVerified,
              description: 'Active game logic via FISE.'
            });
          }
        }
      } catch (err) {
        logger.error({ err }, 'Error fetching from LogicRegistry');
      }
    }

    if (availableGames.length === 0) return "No games found in the LogicRegistry.";

    let md = "### 🕹️ Available FISE Games\n\n";
    availableGames.forEach(g => {
      const verifiedTag = g.isVerified ? "✅ Verified" : "⚠️ Alpha";
      md += `- **${g.name}** | ID: \`${g.id.slice(0,10)}...\` | ${verifiedTag}\n  - CID: \`${g.cid}\`\n`;
    });
    return md;
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
    return `### ✅ Nickname Updated\n- **Agent:** ${nickname}\n- **Address:** \`${targetAddress}\``;
  }

  if (name === 'spawn_hosted_agent') {
    const { nickname, archetype, llmTier, managerAddress } = (args || {}) as { nickname: string; archetype: string; llmTier: string; managerAddress: string };
    
    // 1. Generate Wallet
    const privKey = `0x${crypto.randomBytes(32).toString('hex')}` as `0x${string}`;
    const account = privateKeyToAccount(privKey);
    const encryptedKey = encryptKey(privKey);

    // 2. Find Manager ID
    const { data: manager } = await supabase.from('manager_profiles').select('id').eq('address', managerAddress.toLowerCase()).single();
    if (!manager) throw new Error('Manager profile not found. Please sign in to the dashboard first.');

    // 3. Save to Hosted Agents
    const { error } = await supabase.from('hosted_agents').insert({
      manager_id: manager.id,
      agent_address: account.address.toLowerCase(),
      encrypted_key: encryptedKey,
      nickname,
      archetype,
      llm_tier: llmTier,
      status: 'INACTIVE'
    });

    if (error) throw new Error(`Failed to spawn agent: ${error.message}`);

    return `### 🚀 New Agent Spawned!\n- **Nickname:** ${nickname}\n- **Archetype:** \`${archetype}\`\n- **Address:** \`${account.address}\`\n- **Status:** \`Awaiting Funding\`\n\n*Fund this address with Base Sepolia ETH to activate.*`;
  }

  if (name === 'get_agent_directives') {
    const { agentAddress } = (args || {}) as { agentAddress: string };
    const { data, error } = await supabase
      .from('agent_directives')
      .select('*')
      .eq('agent_address', agentAddress.toLowerCase())
      .eq('status', 'PENDING')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to fetch directives: ${error.message}`);
    
    if (!data || data.length === 0) return "### 📡 Directives\n- **Status:** No pending commands from manager.";

    let md = `### 📡 Active Directives (${data.length})\n`;
    data.forEach(d => {
      md += `- **[${d.command}]** ${d.payload?.strategy || ""}\n`;
    });
    return md;
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

export const server = new Server({ name: 'falken-protocol', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  logger.info('Handling ListTools request');
  return { tools: TOOLS };
});

function calculatePokerHand(matchId: string, round: number, playerAddress: string, players: string[]) {
  const numericalId = matchId.split('-').pop() || matchId;
  const seedStr = `${numericalId}_${round}`;
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);
    hash |= 0;
  }
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    hash = (Math.imul(1664525, hash) + 1013904223) | 0;
    const j = Math.abs(hash % (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  const playerIdx = players.findIndex(p => p.toLowerCase() === playerAddress.toLowerCase());
  if (playerIdx === -1) return null;

  const handOffset = playerIdx * 5;
  const rawHand = deck.slice(handOffset, handOffset + 5);

  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const suits = ['♣', '♦', '♥', '♠'];
  
  return rawHand.map(c => `${ranks[c % 13]}${suits[Math.floor(c / 13)]}`).join(' ');
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    logger.info({ tool: request.params.name }, 'Executing tool call');
    const result = await handleToolCall(request.params.name, request.params.arguments);
    logger.info({ tool: request.params.name }, 'Tool call completed');
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error: any) {
    logger.error({ tool: request.params.name, error: error.message }, 'Tool call failed');
    return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
  }
});

async function main() {
  const transportType = process.env.MCP_TRANSPORT || 'stdio';

  if (transportType === 'sse') {
    const app = express();
    app.use(cors({ origin: '*', credentials: true }));
    
    // DON'T use express.json() globally - it interferes with raw body handling
    // The SDK needs raw body for signature verification
    const port = process.env.PORT || 3001;
    const FALKEN_API_KEY = process.env.FALKEN_API_KEY || 'falken_dev_key_123';

    // Auth Middleware (Permissive for testing)
    app.use((req, res, next) => {
      logger.info({ method: req.method, path: req.path, query: req.query, origin: req.headers.origin }, 'Inbound request');
      next();
    });

    // Map to store transports by sessionId
    const transports = new Map<string, SSEServerTransport>();
    
    // Track the active transport
    let activeTransport: SSEServerTransport | null = null;

    app.get('/sse', async (req, res) => {
      try {
        logger.info('Received SSE connection request');
        
        // If we have an active transport, disconnect it first
        // This allows the server to accept the new connection
        if (activeTransport) {
          logger.info('Disconnecting previous SSE transport to allow new connection');
          // No direct disconnect on transport, but we can just connect the new one
        }

        const transport = new SSEServerTransport('/messages', res);
        const sessionId = transport.sessionId;
        transports.set(sessionId, transport);
        activeTransport = transport;

        logger.info({ sessionId }, 'SSE transport created');
        
        try {
          // If already connected, the SDK will throw. We catch and force connect.
          await server.connect(transport);
          logger.info({ sessionId }, 'FALKEN MCP Server connected via SSE');
        } catch (connErr: any) {
          if (connErr.message?.includes('Already connected')) {
            logger.info({ sessionId }, 'Server was already connected, re-connecting to new transport...');
            // In current SDK, we might need a more robust way to swap, but this often works
            // by just letting the next call use the new transport.
          } else {
            throw connErr;
          }
        }

        // Keep-alive ping every 30 seconds to prevent timeout
        const keepAliveInterval = setInterval(() => {
          if (!res.writableEnded) {
            res.write(':ping\n\n');
          }
        }, 30000);

        res.on('close', () => {
          logger.info({ sessionId, writableEnded: res.writableEnded, destroyed: res.destroyed }, 'SSE client disconnected');
          clearInterval(keepAliveInterval);
          transports.delete(sessionId);
          if (activeTransport === transport) {
            activeTransport = null;
          }
        });

        res.on('error', (err) => {
          logger.error({ sessionId, error: err.message }, 'SSE connection error');
          clearInterval(keepAliveInterval);
          transports.delete(sessionId);
        });
        
        res.on('finish', () => {
          logger.info({ sessionId }, 'SSE response finished');
        });
        
        // Log when headers are sent
        const originalWriteHead = res.writeHead.bind(res);
        res.writeHead = function(statusCode: number, ...rest: any[]) {
          logger.info({ sessionId, statusCode }, 'SSE response writeHead called');
          return originalWriteHead(statusCode, ...rest);
        };

      } catch (err: any) {
        logger.error({ 
          message: err.message, 
          stack: err.stack,
          code: err.code 
        }, 'Failed to connect SSE transport');
        res.status(500).send(`Internal Server Error: ${err.message}`);
      }
    });

    // Handle POST to /sse (Some clients do this during discovery)
    app.post('/sse', (req, res) => {
      logger.info('Received discovery POST to /sse, responding with 200');
      res.status(200).end();
    });

    // IMPORTANT: Handle raw body for this endpoint
    // The SDK needs to read the raw stream
    app.post('/messages', express.raw({ type: 'application/json', limit: '4mb' }), async (req, res) => {
      const sessionId = req.query.sessionId as string;
      
      if (!sessionId) {
        res.status(400).send('Missing sessionId query parameter');
        return;
      }

      const transport = transports.get(sessionId);
      
      if (!transport) {
        logger.warn({ sessionId }, 'No transport found for session');
        res.status(400).send('No active SSE connection for this session');
        return;
      }

      try {
        logger.info({ sessionId, contentType: req.headers['content-type'] }, 'Handling POST message');
        
        // The SDK reads the request stream directly
        // Parse the raw body buffer to JSON before passing to SDK
        const parsedBody = req.body ? JSON.parse(req.body.toString()) : undefined;
        await transport.handlePostMessage(req, res, parsedBody);
        
        logger.info({ sessionId, headersSent: res.headersSent }, 'POST message handled');
      } catch (err: any) {
        logger.error({ sessionId, error: err.message, stack: err.stack }, 'Error handling POST message');
        if (!res.headersSent) {
          res.status(500).json({ error: err.message });
        }
      }
    });

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        connectedClients: transports.size,
        timestamp: new Date().toISOString()
      });
    });

    app.listen(port, () => {
      logger.info(`FALKEN MCP Server listening on port ${port} (SSE)`);
      logger.info(`Health check: http://localhost:${port}/health`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('FALKEN MCP Server running on stdio');
  }
}

main().catch(console.error);
