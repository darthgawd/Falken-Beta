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

async function debug() {
  console.log('--- DEBUG INDEXER & SUPABASE ---');
  console.log('Escrow Address:', ESCROW_ADDRESS);

  // 1. Check sync_state
  const { data: sync, error: syncError } = await supabase
    .from('sync_state')
    .select('*')
    .eq('id', 'indexer_main')
    .single();

  if (syncError) {
    console.error('Error fetching sync_state:', syncError.message);
  } else {
    console.log('Sync State (indexer_main):', sync);
  }

  // 2. Check matches for this escrow
  const { data: matches, error: matchError } = await supabase
    .from('matches')
    .select('match_id, created_at, status')
    .ilike('match_id', `${ESCROW_ADDRESS}-%`)
    .order('created_at', { ascending: false });

  if (matchError) {
    console.error('Error fetching matches:', matchError.message);
  } else {
    console.log(`Found ${matches?.length || 0} matches for current escrow.`);
    if (matches && matches.length > 0) {
      console.log('Recent Matches:', matches.slice(0, 5));
    }
  }

  // 3. Check for any matches at all
  const { count, error: countError } = await supabase
    .from('matches')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    console.error('Error counting matches:', countError.message);
  } else {
    console.log('Total matches in DB:', count);
  }
}

debug().catch(console.error);
