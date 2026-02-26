const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log('🚀 Starting Agent Stats Backfill...');

  // 1. Reset all stats to baseline to avoid double counting if we run this multiple times
  console.log('Resetting all agent stats to baseline (1200 Elo, 0 wins/losses/draws)...');
  const { error: resetError } = await supabase
    .from('agent_profiles')
    .update({ wins: 0, losses: 0, draws: 0, elo: 1200 })
    .neq('address', '0x0'); // Dummy filter to satisfy WHERE requirement
  
  if (resetError) {
    console.error('Failed to reset stats:', resetError);
    return;
  }

  // 2. Fetch all SETTLED matches ordered by creation time (important for Elo sequence)
  const { data: matches, error: fetchError } = await supabase
    .from('matches')
    .select('match_id, player_a, player_b, winner, status, created_at')
    .eq('status', 'SETTLED')
    .order('created_at', { ascending: true });

  if (fetchError) {
    console.error('Failed to fetch matches:', fetchError);
    return;
  }

  console.log(`Found ${matches.length} settled matches to process.`);

  for (const match of matches) {
    const isVoid = match.winner === '0x0000000000000000000000000000000000000000';
    if (isVoid) {
      console.log(`Match ${match.match_id} is void, skipping.`);
      continue;
    }

    if (!match.player_b) {
      console.log(`Match ${match.match_id} has no player_b, skipping.`);
      continue;
    }

    let winnerIndex = 0; // Draw
    if (match.winner && match.player_a && match.winner.toLowerCase() === match.player_a.toLowerCase()) winnerIndex = 1;
    else if (match.winner && match.player_b && match.winner.toLowerCase() === match.player_b.toLowerCase()) winnerIndex = 2;

    console.log(`Processing Match ${match.match_id}: Winner Index ${winnerIndex}`);

    const { error: rpcError } = await supabase.rpc('settle_match_elo', {
      p_player_a: match.player_a,
      p_player_b: match.player_b,
      p_winner_index: winnerIndex
    });

    if (rpcError) {
      console.error(`Failed to settle match ${match.match_id}:`, rpcError);
    }
  }

  console.log('✅ Stats backfill complete.');
}

main().catch(console.error);
