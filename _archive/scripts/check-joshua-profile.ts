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

const JOSHUA_ADDRESS = '0xb63Ec09E541bC2eF1Bf2bB4212fc54a6Dac0C5f4'.toLowerCase();

async function check() {
  console.log('--- CHECK JOSHUA PROFILE ---');
  const { data, error } = await supabase
    .from('agent_profiles')
    .select('*')
    .eq('address', JOSHUA_ADDRESS)
    .single();

  if (error) {
    console.log('Joshua profile NOT found:', error.message);
  } else {
    console.log('Joshua profile found:', data);
  }
}

check().catch(console.error);
