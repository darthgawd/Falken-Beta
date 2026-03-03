import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const ESCROW_ADDRESS = (process.env.ESCROW_ADDRESS || '').toLowerCase();

async function wipe() {
  console.log('--- WIPE ALL MATCH DATA ---');
  
  // 1. Delete all rounds
  const { error: roundsError } = await supabase
    .from('rounds')
    .delete()
    .neq('match_id', 'sentinel'); // Delete everything

  if (roundsError) console.error('Error wiping rounds:', roundsError.message);
  else console.log('Successfully wiped all rounds.');

  // 2. Delete all matches
  const { error: matchesError } = await supabase
    .from('matches')
    .delete()
    .neq('match_id', 'sentinel'); // Delete everything

  if (matchesError) console.error('Error wiping matches:', matchesError.message);
  else console.log('Successfully wiped all matches.');

  // 3. Reset indexer sync state to 0 or start block
  const startBlock = process.env.START_BLOCK ? parseInt(process.env.START_BLOCK) : 0;
  console.log(`Resetting sync_state to ${startBlock}`);
  
  const { error: syncError } = await supabase
    .from('sync_state')
    .update({ last_processed_block: startBlock })
    .eq('id', 'indexer_main');

  if (syncError) console.error('Error resetting sync state:', syncError.message);
  else console.log('Successfully reset indexer sync state.');
}

wipe().catch(console.error);
