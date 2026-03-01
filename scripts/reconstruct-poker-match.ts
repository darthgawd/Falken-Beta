import ShowdownBlitzPoker from '../poker.js';
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

async function run() {
  const matchId = '0x8e8048213960b8a1126cb56faf8085dcce35dac0-24';
  
  // 1. Fetch moves and salts
  const { data: rounds } = await supabase.from('rounds').select('*').eq('match_id', matchId);
  if (!rounds) return;

  const logic = new ShowdownBlitzPoker();
  const context = { playerA: rounds[0].player_address, playerB: rounds[1].player_address, stake: '1000' };
  let state = logic.init(context);

  rounds.forEach(r => {
    state = logic.processMove(state, {
      player: r.player_address,
      moveData: r.move,
      salt: r.salt,
      round: r.round_number
    });
  });

  console.log('--- POKER RECONSTRUCTION #24 ---');
  Object.keys(state.hands).forEach(player => {
    console.log(`Player ${player}:`);
    console.log(`  Discards: ${state.discards[player]}`);
    console.log(`  Final Hand (IDs): ${state.hands[player]}`);
    console.log(`  Visual: ${state.hands[player].map(c => {
        const suits = ['♣', '♦', '♥', '♠'];
        const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
        return ranks[c % 13] + suits[Math.floor(c / 13)];
    }).join(', ')}`);
  });
  console.log('Result:', state.result === 1 ? 'Player A won' : (state.result === 2 ? 'Player B won' : 'Draw'));
}

run().catch(console.error);
