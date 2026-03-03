import ShowdownBlitzPoker from '../poker.js';

async function test() {
  console.log('--- TESTING POKER BLITZ LOGIC ---');
  
  const logic = new ShowdownBlitzPoker();
  const context = {
    playerA: '0xAAAA',
    playerB: '0xBBBB',
    stake: '1000000000'
  };

  // 1. Init
  let state = logic.init(context);

  // 2. Player A discards cards 0 and 1
  state = logic.processMove(state, {
    player: '0xAAAA',
    moveData: '01',
    salt: 'SALT_A',
    round: 1
  });
  console.log('Player A Hand:', state.hands['0xaaaa']);

  // 3. Player B keeps all cards
  state = logic.processMove(state, {
    player: '0xBBBB',
    moveData: '0',
    salt: 'SALT_B',
    round: 1
  });
  console.log('Player B Hand:', state.hands['0xbbbb']);

  // 4. Check Result
  const winner = logic.checkResult(state);
  console.log('Winner (1=A, 2=B, 3=Draw):', winner);

  if (winner !== 0) console.log('✅ TEST PASSED: Poker match resolved.');
  else console.error('❌ TEST FAILED');
}

test().catch(console.error);
