const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function run() {
  const mId = '0x89dd0796e5b5f90d0c21bd09877863783996ce91-6';
  console.log(`Checking match: ${mId}`);
  
  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .eq('match_id', mId)
    .single();

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  console.log('Match Data in DB:');
  console.log(JSON.stringify(data, null, 2));
}

run();
