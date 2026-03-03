import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/**
 * FISE INTEGRATION TEST: SIMULATE_REVEAL_CYCLE
 * Manually inserts match data to trigger the Falken VM.
 */
async function simulateFiseReveal() {
  console.log('\n--- FISE_REVEAL_SIMULATOR STARTING ---');

  const MOCK_MATCH_ID = "test-fise-" + Math.random().toString(36).substring(7);
  const PLAYER_A = '0xac4e9f0d2d5998cc6f05ddb1bd57096db5dbc64a';
  const PLAYER_B = '0xb63ec09e541bc2ef1bf2bb4212fc54a6dac0c5f4'; // Joshua

  console.log(`[1] Creating mock FISE match: ${MOCK_MATCH_ID}`);

  // 1. Create Match Record
  // We set phase to COMMIT first, then update to REVEAL to trigger the DB Watcher
  await supabase.from('matches').insert({
    match_id: MOCK_MATCH_ID,
    player_a: PLAYER_A,
    player_b: PLAYER_B,
    game_logic: 'FISE_SENTINEL',
    stake_wei: '1000000000000000',
    status: 'ACTIVE',
    phase: 'COMMIT',
    current_round: 1
  });

  // 2. Insert Revealed Moves for Round 1
  console.log('[2] Inserting verified move revelations...');
  
  await supabase.from('rounds').insert([
    {
      match_id: MOCK_MATCH_ID,
      round_number: 1,
      player_address: PLAYER_A,
      player_index: 1,
      move: 1,
      revealed: true
    },
    {
      match_id: MOCK_MATCH_ID,
      round_number: 1,
      player_address: PLAYER_B,
      player_index: 2,
      move: 3,
      revealed: true
    }
  ]);

  // 3. Flip status to REVEAL to trigger Watcher
  console.log('[3] Triggering Watcher via status update...');
  await supabase.from('matches')
    .update({ phase: 'REVEAL' })
    .eq('match_id', MOCK_MATCH_ID);

  console.log('\n✅ SIMULATION_DATA_DEPLOYED');
  console.log(`ACTION: Watch Falken VM logs for match: ${MOCK_MATCH_ID}`);
  console.log(`EXPECTED_RESULT: Player A (0xac4e...) wins via Rock beats Scissors.\n`);
}

simulateFiseReveal().catch(console.error);
