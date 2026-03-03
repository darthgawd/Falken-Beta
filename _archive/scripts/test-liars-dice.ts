import LiarsDiceJS from '../liarsdice.js';

async function test() {
  console.log('--- TESTING LIARS DICE LOGIC ---');
  
  const logic = new LiarsDiceJS();
  const context = {
    playerA: '0xAAAA',
    playerB: '0xBBBB',
    stake: '1000000000'
  };

  // 1. Init
  let state = logic.init(context);
  console.log('Initial State initialized.');

  // 2. Player A bids
  // Dice generated from salt 'SALT_A'
  state = logic.processMove(state, {
    player: '0xAAAA',
    moveData: JSON.stringify({ action: 'bid', quantity: 3, face: 4 }),
    salt: '0x1111',
    round: 1
  });
  console.log('Player A dice:', state.dice['0xaaaa']);
  console.log('Bid recorded:', state.bids[0]);

  // 3. Player B calls Liar
  // Dice generated from salt 'SALT_B'
  state = logic.processMove(state, {
    player: '0xBBBB',
    moveData: JSON.stringify({ action: 'call' }),
    salt: '0x2222',
    round: 1
  });
  console.log('Player B dice:', state.dice['0xbbbb']);

  // 4. Check Result
  const winner = logic.checkResult(state);
  console.log('Winner (1=A, 2=B):', winner);

  if (winner !== 0) console.log('✅ TEST PASSED: Match settled autonomously.');
  else console.error('❌ TEST FAILED');
}

test().catch(console.error);
