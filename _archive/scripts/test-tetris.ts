// @ts-ignore
import TetrisDuel from '../tetris.js';

async function test() {
  console.log('--- TESTING TETRIS DUEL LOGIC ---');
  
  const logic = new TetrisDuel();
  const context = {
    playerA: '0xAAAA',
    playerB: '0xBBBB',
    seed: 'FALKEN_GENESIS_SEED'
  };

  // 1. Init
  let state = logic.init(context);
  console.log('Initial State initialized.');
  console.log('First 5 pieces in bag:', state.pieceBag.slice(0, 5));

  // Helper to render board
  const renderBoard = (board: number[][]) => {
    const rows = board.slice().reverse(); // Show top at top
    return rows.map(row => row.map(cell => cell === 0 ? '.' : (cell === 8 ? 'X' : '#')).join('')).join('\n');
  };

  // 2. Simulate 5 rounds of strategic drops
  for (let round = 0; round < 5; round++) {
    const piece = state.pieceBag[state.currentPieceIndex];
    console.log(`\nROUND ${round + 1} - PIECE: ${piece}`);

    // Player A tries to stack in column 0
    state = logic.processMove(state, {
      player: '0xAAAA',
      moveData: 0, // Rotation 0, Column 0
      salt: '0x1111',
      round: round + 1
    });

    // Player B tries to stack in column 5
    state = logic.processMove(state, {
      player: '0xBBBB',
      moveData: 5, // Rotation 0, Column 5
      salt: '0x2222',
      round: round + 1
    });

    console.log(`Player A Score: ${state.scoreA} | Player B Score: ${state.scoreB}`);
  }

  console.log('\n--- PLAYER A BOARD ---');
  console.log(renderBoard(state.boardA));
  
  console.log('\n--- PLAYER B BOARD ---');
  console.log(renderBoard(state.boardB));

  // 3. Test Line Clear & Garbage (Manual override for testing)
  console.log('\n--- TESTING LINE CLEAR & GARBAGE ---');
  
  // Fill bottom row of A to force a clear
  state.boardA[0] = Array(10).fill(1);
  state.boardA[0][0] = 0; // Leave one hole at col 0
  
  console.log('Board A before drop (simulated hole at 0,0):');
  console.log(renderBoard(state.boardA.slice(0, 3)));

  // Force an 'I' piece and drop it in the hole
  // I piece rotation 1 is vertical. MoveData 10 = Rotation 1, Col 0
  state.pieceBag[state.currentPieceIndex] = 'I';
  
  state = logic.processMove(state, {
    player: '0xAAAA',
    moveData: 10, 
    salt: '0x3333',
    round: 6
  });

  state = logic.processMove(state, {
    player: '0xBBBB',
    moveData: 5,
    salt: '0x4444',
    round: 6
  });

  console.log('Board A after drop (Row 0 should be cleared):');
  console.log(renderBoard(state.boardA.slice(0, 3)));
  
  // 4. Test Top-Out
  console.log('\n--- TESTING TOP-OUT ---');
  // Fill Player B's board to row 18
  state.boardB[18][5] = 1; 
  
  state = logic.processMove(state, {
    player: '0xAAAA',
    moveData: 0,
    salt: '0x5555',
    round: 7
  });

  state = logic.processMove(state, {
    player: '0xBBBB',
    moveData: 0,
    salt: '0x6666',
    round: 7
  });

  const finalWinner = logic.checkResult(state);
  console.log('Winner (1=A, 2=B):', finalWinner);
  if (finalWinner === 1) {
    console.log('✅ TEST PASSED: Player B topped out, Player A wins.');
  } else {
    console.error('❌ TEST FAILED: Top-out not detected at row 18.');
  }
}

test().catch(console.error);
