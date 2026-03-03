import HighRollerDice from '../highroller.js';

async function test() {
  console.log('--- TESTING HIGHROLLER LOGIC ---');
  
  const logic = new HighRollerDice();
  const context = {
    playerA: '0xAAAA',
    playerB: '0xBBBB',
    stake: '1000000000'
  };

  // 1. Init
  let state = logic.init(context);
  console.log('Initial State:', state);

  // 2. Process Move A
  state = logic.processMove(state, {
    player: '0xAAAA',
    moveData: '85',
    round: 1
  });
  console.log('State after A moves:', state);

  // 3. Process Move B
  state = logic.processMove(state, {
    player: '0xBBBB',
    moveData: '42',
    round: 1
  });
  console.log('State after B moves:', state);

  // 4. Check Result
  const winner = logic.checkResult(state);
  console.log('Winner:', winner); // Should be 1

  if (winner === 1) console.log('✅ TEST PASSED: Player A wins with 85 vs 42');
  else console.error('❌ TEST FAILED');
}

test().catch(console.error);
