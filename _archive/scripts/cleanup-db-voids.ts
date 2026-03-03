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

async function cleanup() {
  console.log('--- CLEANUP DB STATUS ---');
  
  const matchesToVoid = [
    `${ESCROW_ADDRESS}-1`,
    `${ESCROW_ADDRESS}-2`,
    `${ESCROW_ADDRESS}-3`,
    `${ESCROW_ADDRESS}-4`
  ];

  console.log('Setting matches to VOIDED:', matchesToVoid);

  const { error } = await supabase
    .from('matches')
    .update({ status: 'VOIDED', phase: 'COMPLETE' })
    .in('match_id', matchesToVoid);

  if (error) {
    console.error('Error updating matches:', error.message);
  } else {
    console.log('Successfully updated matches to VOIDED in DB.');
  }
}

cleanup().catch(console.error);
