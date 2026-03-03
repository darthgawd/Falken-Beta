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

async function fix() {
  const startBlock = 38233444;
  console.log(`Forcing sync_state to ${startBlock} for new deployment...`);
  const { error } = await supabase
    .from('sync_state')
    .upsert({ id: 'indexer_main', last_processed_block: startBlock });
  
  if (error) console.error(error);
  else console.log('Successfully updated sync_state to new deployment block.');
}

fix().catch(console.error);
