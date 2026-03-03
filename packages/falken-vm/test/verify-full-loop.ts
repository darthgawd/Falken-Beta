import { Watcher } from '../src/Watcher';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/**
 * ONE-SHOT INTEGRATION TEST: VERIFY_FULL_LOOP
 * Directly calls the processMatch logic to prove the loop works.
 */
async function testFullLoop() {
  console.log('--- FISE FULL-LOOP TEST STARTING ---');

  const MOCK_MATCH_ID = `test-fise-final-${Math.random().toString(36).substring(7)}`;
  const PLAYER_A = '0xac4e9f0d2d5998cc6f05ddb1bd57096db5dbc64a';
  const PLAYER_B = '0xb63ec09e541bc2ef1bf2bb4212fc54a6dac0c5f4';

  // 1. Create Data
  console.log(`[1] Seeding Supabase with match: ${MOCK_MATCH_ID}`);
  await supabase.from('matches').insert({
    match_id: MOCK_MATCH_ID,
    player_a: PLAYER_A,
    player_b: PLAYER_B,
    game_logic: 'FISE_SENTINEL',
    stake_wei: '1000000000000000',
    status: 'ACTIVE',
    phase: 'REVEAL',
    current_round: 1
  });

  await supabase.from('rounds').insert([
    { match_id: MOCK_MATCH_ID, round_number: 1, player_address: PLAYER_A, player_index: 1, move: 1, revealed: true },
    { match_id: MOCK_MATCH_ID, round_number: 1, player_address: PLAYER_B, player_index: 2, move: 3, revealed: true }
  ]);

  // 2. Trigger Loop Logic Directly
  console.log('[2] Manually triggering Watcher.processMatch...');
  const watcher = new Watcher();
  
  // We use a dummy address for the escrow as it's not used in simulation mode
  await (watcher as any).processMatch(MOCK_MATCH_ID, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000');

  // 3. Verify Result
  console.log('[3] Verifying settlement in DB...');
  const { data: match } = await supabase.from('matches').select('*').eq('match_id', MOCK_MATCH_ID).single();

  if (match?.status === 'SETTLED' && match?.winner === PLAYER_A) {
    console.log('✅ SUCCESS: Full loop validated. Match settled via JS logic.');
  } else {
    console.log('❌ FAILURE: Match status:', match?.status, 'Winner:', match?.winner);
    process.exit(1);
  }

  console.log('--- TEST COMPLETE ---');
}

testFullLoop().catch(console.error);
