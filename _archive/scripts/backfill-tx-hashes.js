const { createPublicClient, http, parseEventLogs } = require('viem');
const { baseSepolia } = require('viem/chains');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(process.env.RPC_URL) });
const ESCROW_ADDRESS = (process.env.ESCROW_ADDRESS || '').toLowerCase();

const ESCROW_ABI = [
  { name: 'MoveCommitted', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'roundNumber', type: 'uint8', indexed: false }, { name: 'player', type: 'address', indexed: true }] },
  { name: 'MoveRevealed', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'roundNumber', type: 'uint8', indexed: false }, { name: 'player', type: 'address', indexed: true }, { name: 'move', type: 'uint8', indexed: false }] },
  { name: 'MatchSettled', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'winner', type: 'address', indexed: true }, { name: 'payout', type: 'uint256', indexed: false }] },
];

function getDbMatchId(onChainId) {
  return `${ESCROW_ADDRESS}-${onChainId.toString()}`;
}

async function backfill() {
  const fromBlock = BigInt(process.env.START_BLOCK || '37979974');
  const toBlock = await publicClient.getBlockNumber();
  const CHUNK_SIZE = 10n;
  
  console.log(`🚀 Starting Transaction Hash Backfill: ${fromBlock} -> ${toBlock}`);

  for (let cursor = fromBlock; cursor <= toBlock; cursor += CHUNK_SIZE) {
    const endBlock = cursor + CHUNK_SIZE - 1n > toBlock ? toBlock : cursor + CHUNK_SIZE - 1n;
    console.log(`Fetching logs for blocks ${cursor} to ${endBlock}...`);
    
    try {
      const logs = await publicClient.getLogs({
        address: ESCROW_ADDRESS,
        fromBlock: cursor,
        toBlock: endBlock
      });

      const parsedLogs = parseEventLogs({ abi: ESCROW_ABI, logs });
      
      for (const log of parsedLogs) {
        const { eventName, args, transactionHash } = log;
        const mId = getDbMatchId(args.matchId);

        if (eventName === 'MoveCommitted') {
          const player = args.player.toLowerCase();
          await supabase.from('rounds').update({ 
            commit_tx_hash: transactionHash 
          }).match({ match_id: mId, round_number: args.roundNumber, player_address: player });
        } 
        else if (eventName === 'MoveRevealed') {
          const player = args.player.toLowerCase();
          await supabase.from('rounds').update({ 
            reveal_tx_hash: transactionHash 
          }).match({ match_id: mId, round_number: args.roundNumber, player_address: player });
        }
        else if (eventName === 'MatchSettled') {
          await supabase.from('matches').update({ 
            settle_tx_hash: transactionHash 
          }).eq('match_id', mId);
        }
      }
    } catch (err) {
      console.error(`Error fetching blocks ${cursor}-${endBlock}:`, err.message);
    }
  }

  console.log('✅ Backfill Complete.');
}

backfill().catch(console.error);
