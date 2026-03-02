/**
 * Tetris Duel Stress Test — 1,000 simulated matches
 * Tests all game outcomes, edge cases, and logic correctness.
 *
 * Run: node tests/tetris-stress.js
 */

const TetrisDuel = require('../tetris.js');

let totalGames = 0;
let outcomes = { A_WINS: 0, B_WINS: 0, DRAW: 0, STUCK: 0 };
let errors = [];
let maxRounds = 0;
let totalRounds = 0;
let garbageSent = 0;
let topOuts = 0;
let lineClears = { 1: 0, 2: 0, 3: 0, 4: 0 };

function generateMove(board, pieceType, game) {
  // Try all valid placements, pick one randomly (weighted toward better moves)
  const shapes = game.getPieces()[pieceType];
  const validMoves = [];

  for (let rot = 0; rot < 4; rot++) {
    const shape = shapes[rot];
    const shapeW = shape[0].length;
    for (let col = 0; col <= 10 - shapeW; col++) {
      // Encode as rotation*10 + col
      const moveData = rot * 10 + col;
      // Verify it fits somewhere
      const testBoard = board.map(r => [...r]);
      const lines = game.dropPiece(testBoard, pieceType, moveData);
      const topOut = game.checkTopOut(testBoard);
      validMoves.push({ moveData, lines, topOut });
    }
  }

  // Prefer moves that don't top out, then prefer more line clears
  const safe = validMoves.filter(m => !m.topOut);
  if (safe.length > 0) {
    // 70% chance pick best (most lines), 30% random
    if (Math.random() < 0.7) {
      safe.sort((a, b) => b.lines - a.lines);
      return safe[0].moveData;
    }
    return safe[Math.floor(Math.random() * safe.length)].moveData;
  }
  // All moves top out — pick any
  return validMoves[Math.floor(Math.random() * validMoves.length)].moveData;
}

function runGame(gameIndex) {
  const game = new TetrisDuel();
  const ctx = {
    matchId: `stress-test-${gameIndex}`,
    playerA: `0xAAAA${gameIndex.toString(16).padStart(36, '0')}`,
    playerB: `0xBBBB${gameIndex.toString(16).padStart(36, '0')}`,
    stake: '1000000000000000',
    seed: `seed-${gameIndex}`
  };

  let state = game.init(ctx);

  // Validate init state
  if (state.boardA.length !== 20 || state.boardB.length !== 20) {
    errors.push(`Game ${gameIndex}: Board not 20 rows (A=${state.boardA.length}, B=${state.boardB.length})`);
    return;
  }
  if (state.boardA[0].length !== 10 || state.boardB[0].length !== 10) {
    errors.push(`Game ${gameIndex}: Board not 10 cols`);
    return;
  }
  if (state.pieceBag.length !== 1000) {
    errors.push(`Game ${gameIndex}: Piece bag not 1000 (got ${state.pieceBag.length})`);
    return;
  }

  let round = 0;
  const MAX_ROUNDS = 500; // Safety limit

  while (!state.gameOver && round < MAX_ROUNDS) {
    round++;
    const pieceType = state.pieceBag[state.currentPieceIndex];

    if (!pieceType) {
      errors.push(`Game ${gameIndex}: Ran out of pieces at round ${round}, pieceIndex=${state.currentPieceIndex}`);
      break;
    }

    // Generate moves for both players using COPIES of the board
    const boardACopy = state.boardA.map(r => [...r]);
    const boardBCopy = state.boardB.map(r => [...r]);
    const moveA = generateMove(boardACopy, pieceType, game);
    const moveB = generateMove(boardBCopy, pieceType, game);

    // Process player A's move
    state = game.processMove(state, {
      player: ctx.playerA,
      moveData: moveA,
      round: round
    });

    // Process player B's move
    state = game.processMove(state, {
      player: ctx.playerB,
      moveData: moveB,
      round: round
    });

    // Validate board integrity after each round
    if (state.boardA.length !== 20) {
      errors.push(`Game ${gameIndex}, Round ${round}: Board A has ${state.boardA.length} rows (expected 20)`);
      return;
    }
    if (state.boardB.length !== 20) {
      errors.push(`Game ${gameIndex}, Round ${round}: Board B has ${state.boardB.length} rows (expected 20)`);
      return;
    }
    for (let y = 0; y < 20; y++) {
      if (state.boardA[y].length !== 10) {
        errors.push(`Game ${gameIndex}, Round ${round}: Board A row ${y} has ${state.boardA[y].length} cols`);
        return;
      }
      if (state.boardB[y].length !== 10) {
        errors.push(`Game ${gameIndex}, Round ${round}: Board B row ${y} has ${state.boardB[y].length} cols`);
        return;
      }
    }

    // Validate scores are non-negative
    if (state.scoreA < 0 || state.scoreB < 0) {
      errors.push(`Game ${gameIndex}, Round ${round}: Negative score (A=${state.scoreA}, B=${state.scoreB})`);
      return;
    }

    // Validate result is a valid enum
    const result = game.checkResult(state);
    if (![0, 1, 2, 3].includes(result)) {
      errors.push(`Game ${gameIndex}, Round ${round}: Invalid result ${result}`);
      return;
    }
  }

  totalRounds += round;
  if (round > maxRounds) maxRounds = round;

  const result = game.checkResult(state);
  if (state.gameOver) {
    if (result === 1) outcomes.A_WINS++;
    else if (result === 2) outcomes.B_WINS++;
    else if (result === 3) outcomes.DRAW++;
    else errors.push(`Game ${gameIndex}: gameOver=true but result=${result}`);
    topOuts++;
  } else if (round >= MAX_ROUNDS) {
    outcomes.STUCK++;
    errors.push(`Game ${gameIndex}: Hit ${MAX_ROUNDS} rounds without ending (pieceIndex=${state.currentPieceIndex}, scoreA=${state.scoreA}, scoreB=${state.scoreB})`);
  }

  totalGames++;
}

// --- Specific Edge Case Tests ---

function testEdgeCases() {
  const game = new TetrisDuel();
  const edgeErrors = [];

  // Test 1: Both players top out same round → higher score wins
  console.log('  Edge case 1: Simultaneous top-out...');
  {
    const ctx = { matchId: 'edge-1', playerA: '0xAAA', playerB: '0xBBB', stake: '0', seed: 'edge1' };
    let state = game.init(ctx);
    // Fill boards almost to top
    for (let y = 0; y < 18; y++) {
      for (let x = 0; x < 9; x++) {
        state.boardA[y][x] = 1;
        state.boardB[y][x] = 1;
      }
    }
    state.scoreA = 500;
    state.scoreB = 300;
    // Drop a piece that will top out both
    state = game.processMove(state, { player: '0xaaa', moveData: 0, round: 1 });
    state = game.processMove(state, { player: '0xbbb', moveData: 0, round: 1 });
    if (!state.gameOver) edgeErrors.push('Edge 1: Should be game over on simultaneous top-out');
    if (state.winner !== 1) edgeErrors.push(`Edge 1: Higher score (A=500) should win, got winner=${state.winner}`);
  }

  // Test 2: Piece index overflow (exceed bag size)
  console.log('  Edge case 2: Piece bag exhaustion...');
  {
    const ctx = { matchId: 'edge-2', playerA: '0xAAA', playerB: '0xBBB', stake: '0', seed: 'edge2' };
    let state = game.init(ctx);
    state.currentPieceIndex = 999; // Last piece
    const pieceType = state.pieceBag[999];
    if (!pieceType) edgeErrors.push('Edge 2: Piece bag[999] is undefined');
    state.currentPieceIndex = 1000; // Beyond bag
    const beyondPiece = state.pieceBag[1000];
    if (beyondPiece !== undefined) edgeErrors.push('Edge 2: Piece bag[1000] should be undefined');
  }

  // Test 3: Move data boundary values
  console.log('  Edge case 3: Move encoding boundaries...');
  {
    // moveData=0: rotation 0, col 0
    // moveData=39: rotation 3, col 9
    // moveData=255: rotation 25%4=1, col 5
    const r0 = Math.floor(0 / 10) % 4;
    const c0 = 0 % 10;
    if (r0 !== 0 || c0 !== 0) edgeErrors.push(`Edge 3: moveData=0 → rot=${r0}, col=${c0}`);

    const r39 = Math.floor(39 / 10) % 4;
    const c39 = 39 % 10;
    if (r39 !== 3 || c39 !== 9) edgeErrors.push(`Edge 3: moveData=39 → rot=${r39}, col=${c39}`);

    const r255 = Math.floor(255 / 10) % 4;
    const c255 = 255 % 10;
    if (r255 !== 1 || c255 !== 5) edgeErrors.push(`Edge 3: moveData=255 → rot=${r255}, col=${c255}`);
  }

  // Test 4: Line clear correctness
  console.log('  Edge case 4: Line clear mechanics...');
  {
    const ctx = { matchId: 'edge-4', playerA: '0xAAA', playerB: '0xBBB', stake: '0', seed: 'edge4' };
    let state = game.init(ctx);
    // Fill bottom row completely
    for (let x = 0; x < 10; x++) state.boardA[0][x] = 1;
    const linesBefore = state.boardA[0].every(c => c !== 0);
    if (!linesBefore) edgeErrors.push('Edge 4: Bottom row not full');
    const cleared = game.clearLines(state.boardA);
    if (cleared !== 1) edgeErrors.push(`Edge 4: Expected 1 line cleared, got ${cleared}`);
    if (state.boardA.length !== 20) edgeErrors.push(`Edge 4: Board has ${state.boardA.length} rows after clear`);
    // After clearing bottom row, all rows should be empty (board was empty except row 0)
    const allEmpty = state.boardA.every(row => row.every(c => c === 0));
    if (!allEmpty) edgeErrors.push('Edge 4: Board should be all empty after clearing only filled row');
  }

  // Test 5: Garbage adds at bottom and pushes up
  console.log('  Edge case 5: Garbage direction...');
  {
    const ctx = { matchId: 'edge-5', playerA: '0xAAA', playerB: '0xBBB', stake: '0', seed: 'edge5' };
    let state = game.init(ctx);
    // Place a marker block at row 0 (bottom)
    state.boardA[0][5] = 9;
    game.addGarbage(state, state.boardA, 1);
    // The marker should have moved UP to row 1
    if (state.boardA[1][5] !== 9) edgeErrors.push(`Edge 5: Marker at [0][5] should move to [1][5] after garbage, found ${state.boardA[1][5]}`);
    // Row 0 should be garbage (filled with 8 except one hole)
    const garbageRow = state.boardA[0];
    const eightCount = garbageRow.filter(c => c === 8).length;
    const holeCount = garbageRow.filter(c => c === 0).length;
    if (eightCount !== 9 || holeCount !== 1) edgeErrors.push(`Edge 5: Garbage row should have 9 filled + 1 hole, got ${eightCount} filled + ${holeCount} holes`);
    if (state.boardA.length !== 20) edgeErrors.push(`Edge 5: Board has ${state.boardA.length} rows after garbage`);
  }

  // Test 6: Determinism — same inputs = same outputs
  console.log('  Edge case 6: Determinism...');
  {
    const ctx = { matchId: 'determinism-test', playerA: '0xAAAA', playerB: '0xBBBB', stake: '0', seed: 'det-seed' };
    const game1 = new TetrisDuel();
    const game2 = new TetrisDuel();
    let state1 = game1.init(ctx);
    let state2 = game2.init(ctx);

    // Play 50 rounds with fixed moves
    for (let i = 0; i < 50 && !state1.gameOver && !state2.gameOver; i++) {
      const moveData = (i * 7 + 3) % 40; // Deterministic move sequence
      state1 = game1.processMove(state1, { player: ctx.playerA, moveData, round: i + 1 });
      state1 = game1.processMove(state1, { player: ctx.playerB, moveData, round: i + 1 });
      state2 = game2.processMove(state2, { player: ctx.playerA, moveData, round: i + 1 });
      state2 = game2.processMove(state2, { player: ctx.playerB, moveData, round: i + 1 });
    }

    if (state1.scoreA !== state2.scoreA || state1.scoreB !== state2.scoreB) {
      edgeErrors.push(`Edge 6: Non-deterministic! Scores differ: A(${state1.scoreA} vs ${state2.scoreA}), B(${state1.scoreB} vs ${state2.scoreB})`);
    }
    if (JSON.stringify(state1.boardA) !== JSON.stringify(state2.boardA)) {
      edgeErrors.push('Edge 6: Non-deterministic! Board A differs between runs');
    }
    if (state1.gameOver !== state2.gameOver || state1.winner !== state2.winner) {
      edgeErrors.push('Edge 6: Non-deterministic! Game outcome differs');
    }
  }

  // Test 7: processMove after gameOver is idempotent
  console.log('  Edge case 7: Post-gameOver idempotency...');
  {
    const ctx = { matchId: 'edge-7', playerA: '0xAAA', playerB: '0xBBB', stake: '0', seed: 'edge7' };
    let state = game.init(ctx);
    state.gameOver = true;
    state.winner = 1;
    const scoreBefore = state.scoreA;
    state = game.processMove(state, { player: '0xaaa', moveData: 5, round: 1 });
    if (state.scoreA !== scoreBefore) edgeErrors.push('Edge 7: Score changed after gameOver');
    if (state.winner !== 1) edgeErrors.push('Edge 7: Winner changed after gameOver');
  }

  // Test 8: Garbage count table
  console.log('  Edge case 8: Garbage count mapping...');
  {
    if (game.getGarbageCount(0) !== 0) edgeErrors.push('Edge 8: 0 lines should send 0 garbage');
    if (game.getGarbageCount(1) !== 0) edgeErrors.push('Edge 8: 1 line should send 0 garbage');
    if (game.getGarbageCount(2) !== 1) edgeErrors.push('Edge 8: 2 lines should send 1 garbage');
    if (game.getGarbageCount(3) !== 2) edgeErrors.push('Edge 8: 3 lines should send 2 garbage');
    if (game.getGarbageCount(4) !== 4) edgeErrors.push('Edge 8: 4 lines should send 4 garbage');
  }

  // Test 9: Score table
  console.log('  Edge case 9: Score calculation...');
  {
    if (game.calculateScore(0) !== 0) edgeErrors.push('Edge 9: 0 lines = 0 points');
    if (game.calculateScore(1) !== 100) edgeErrors.push('Edge 9: 1 line = 100 points');
    if (game.calculateScore(2) !== 300) edgeErrors.push('Edge 9: 2 lines = 300 points');
    if (game.calculateScore(3) !== 500) edgeErrors.push('Edge 9: 3 lines = 500 points');
    if (game.calculateScore(4) !== 800) edgeErrors.push('Edge 9: 4 lines = 800 points');
  }

  // Test 10: Same player can't move twice in same round
  console.log('  Edge case 10: Duplicate move handling...');
  {
    const ctx = { matchId: 'edge-10', playerA: '0xAAA', playerB: '0xBBB', stake: '0', seed: 'edge10' };
    let state = game.init(ctx);
    state = game.processMove(state, { player: '0xaaa', moveData: 5, round: 1 });
    const pieceIdxAfterFirst = state.currentPieceIndex;
    // Same player moves again in same round — should overwrite, not advance
    state = game.processMove(state, { player: '0xaaa', moveData: 15, round: 1 });
    if (state.currentPieceIndex !== pieceIdxAfterFirst) {
      edgeErrors.push('Edge 10: Piece index advanced on duplicate single-player move');
    }
  }

  return edgeErrors;
}

// --- Run ---

console.log('=== TETRIS DUEL STRESS TEST ===\n');

console.log('Running edge case tests...');
const edgeErrors = testEdgeCases();
if (edgeErrors.length > 0) {
  console.log(`\n  EDGE CASE FAILURES (${edgeErrors.length}):`);
  edgeErrors.forEach(e => console.log(`    - ${e}`));
} else {
  console.log('  All edge cases PASSED\n');
}

console.log(`Running 1,000 full matches...`);
const startTime = Date.now();
for (let i = 0; i < 1000; i++) {
  runGame(i);
  if ((i + 1) % 200 === 0) process.stdout.write(`  ${i + 1}/1000\n`);
}
const elapsed = Date.now() - startTime;

console.log(`\n=== RESULTS ===`);
console.log(`Total games:    ${totalGames}`);
console.log(`Time:           ${elapsed}ms (${(elapsed / totalGames).toFixed(1)}ms/game)`);
console.log(`Outcomes:`);
console.log(`  A wins:       ${outcomes.A_WINS} (${(outcomes.A_WINS / totalGames * 100).toFixed(1)}%)`);
console.log(`  B wins:       ${outcomes.B_WINS} (${(outcomes.B_WINS / totalGames * 100).toFixed(1)}%)`);
console.log(`  Draws:        ${outcomes.DRAW} (${(outcomes.DRAW / totalGames * 100).toFixed(1)}%)`);
console.log(`  Stuck:        ${outcomes.STUCK} (${(outcomes.STUCK / totalGames * 100).toFixed(1)}%)`);
console.log(`Rounds:`);
console.log(`  Avg rounds:   ${(totalRounds / totalGames).toFixed(1)}`);
console.log(`  Max rounds:   ${maxRounds}`);

if (errors.length > 0) {
  console.log(`\nERRORS (${errors.length}):`);
  errors.slice(0, 20).forEach(e => console.log(`  - ${e}`));
  if (errors.length > 20) console.log(`  ... and ${errors.length - 20} more`);
} else {
  console.log(`\nNo errors detected.`);
}

const exitCode = (errors.length + edgeErrors.length) > 0 ? 1 : 0;
console.log(`\n${exitCode === 0 ? 'ALL TESTS PASSED' : 'TESTS FAILED'}`);
process.exit(exitCode);
