/**
 * TETRIS DUEL (1v1 Adversarial)
 * A turn-based strategic Tetris benchmark for the Falken Protocol.
 * 
 * Rules:
 * - 10x20 Board.
 * - Both players receive the same piece sequence (Deterministic Bag).
 * - Simultaneous turns: Each player commits (Rotation, Column).
 * - Clearing lines sends "Garbage" to the opponent.
 * - Topping out (exceeding Row 19) results in an instant loss.
 */

class TetrisDuel {
  // Tetromino shapes and their 4 rotations
  // 0: empty, 1-7: piece types
  getPieces() {
    return {
      I: [[[1,1,1,1]], [[1],[1],[1],[1]], [[1,1,1,1]], [[1],[1],[1],[1]]],
      J: [[[2,0,0],[2,2,2]], [[2,2],[2,0],[2,0]], [[2,2,2],[0,0,2]], [[0,2],[0,2],[2,2]]],
      L: [[[0,0,3],[3,3,3]], [[3,0],[3,0],[3,3]], [[3,3,3],[3,0,0]], [[3,3],[0,3],[0,3]]],
      O: [[[4,4],[4,4]], [[4,4],[4,4]], [[4,4],[4,4]], [[4,4],[4,4]]],
      S: [[[0,5,5],[5,5,0]], [[5,0],[5,5],[0,5]], [[0,5,5],[5,5,0]], [[5,0],[5,5],[0,5]]],
      T: [[[0,6,0],[6,6,6]], [[6,0],[6,6],[6,0]], [[6,6,6],[0,6,0]], [[0,6],[6,6],[0,6]]],
      Z: [[[7,7,0],[0,7,7]], [[0,7],[7,7],[7,0]], [[7,7,0],[0,7,7]], [[0,7],[7,7],[7,0]]]
    };
  }

  init(ctx) {
    // Generate deterministic bag of 1000 pieces
    const pieceTypes = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
    const bag = [];
    let seed = this.hash(ctx.seed);
    
    for (let i = 0; i < 1000; i++) {
      seed = (Math.imul(1664525, seed) + 1013904223) | 0;
      bag.push(pieceTypes[Math.abs(seed % 7)]);
    }

    return {
      playerA: ctx.playerA,
      playerB: ctx.playerB,
      boardA: Array(20).fill(null).map(() => Array(10).fill(0)),
      boardB: Array(20).fill(null).map(() => Array(10).fill(0)),
      scoreA: 0,
      scoreB: 0,
      currentPieceIndex: 0,
      pieceBag: bag,
      gameOver: false,
      winner: 0,
      rounds: {} // Store raw moves per round
    };
  }

  processMove(state, move) {
    if (state.gameOver) return state;

    const roundNum = move.round;
    if (!state.rounds[roundNum]) state.rounds[roundNum] = {};
    
    const isA = move.player.toLowerCase() === state.playerA.toLowerCase();
    if (isA) state.rounds[roundNum].a = move.moveData;
    else state.rounds[roundNum].b = move.moveData;

    const r = state.rounds[roundNum];
    if (r.a !== undefined && r.b !== undefined) {
      // Both revealed! Resolve the turn
      const pieceType = state.pieceBag[state.currentPieceIndex];
      
      const linesClearedA = this.dropPiece(state.boardA, pieceType, r.a);
      const linesClearedB = this.dropPiece(state.boardB, pieceType, r.b);

      // Check for Top-Out BEFORE adding garbage
      const topOutA = this.checkTopOut(state.boardA);
      const topOutB = this.checkTopOut(state.boardB);

      if (topOutA || topOutB) {
        state.gameOver = true;
        if (topOutA && topOutB) state.winner = state.scoreA > state.scoreB ? 1 : (state.scoreB > state.scoreA ? 2 : 0);
        else state.winner = topOutA ? 2 : 1;
        return state;
      }

      // Handle Garbage Sending
      if (linesClearedA >= 2) this.addGarbage(state.boardB, this.getGarbageCount(linesClearedA));
      if (linesClearedB >= 2) this.addGarbage(state.boardA, this.getGarbageCount(linesClearedB));

      state.scoreA += this.calculateScore(linesClearedA);
      state.scoreB += this.calculateScore(linesClearedB);
      state.currentPieceIndex++;
    }

    return state;
  }

  checkResult(state) {
    return state.winner;
  }

  // --- HELPERS ---

  dropPiece(board, type, moveData) {
    const rotation = Math.floor(moveData / 10) % 4;
    const col = moveData % 10;
    const shape = this.getPieces()[type][rotation];
    const shapeW = shape[0].length;
    const shapeH = shape.length;

    // Clamp column
    const startCol = Math.max(0, Math.min(col, 10 - shapeW));

    // Find lowest Y (gravity)
    let landingY = 19;
    for (let y = 19; y >= (shapeH - 1); y--) {
      if (this.canFit(board, shape, y, startCol)) {
        landingY = y;
      } else {
        break; // Hit something
      }
    }

    // Place piece
    for (let sy = 0; sy < shapeH; sy++) {
      for (let sx = 0; sx < shapeW; sx++) {
        if (shape[sy][sx] !== 0) {
          const boardY = landingY - (shapeH - 1 - sy);
          if (boardY >= 0 && boardY < 20) {
            board[boardY][startCol + sx] = shape[sy][sx];
          }
        }
      }
    }

    return this.clearLines(board);
  }

  canFit(board, shape, y, x) {
    const h = shape.length;
    const w = shape[0].length;
    for (let sy = 0; sy < h; sy++) {
      for (let sx = 0; sx < w; sx++) {
        if (shape[sy][sx] !== 0) {
          const boardY = y - (h - 1 - sy);
          const boardX = x + sx;
          // Check bounds
          if (boardY < 0 || boardY >= 20 || boardX < 0 || boardX >= 10) return false;
          // Check collision
          if (board[boardY][boardX] !== 0) return false;
        }
      }
    }
    return true;
  }

  clearLines(board) {
    let lines = 0;
    for (let y = 0; y < 20; y++) {
      if (board[y].every(cell => cell !== 0)) {
        board.splice(y, 1);
        board.push(Array(10).fill(0));
        y--;
        lines++;
      }
    }
    return lines;
  }

  addGarbage(board, count) {
    for (let i = 0; i < count; i++) {
      board.shift(); // Remove top row
      const garbageRow = Array(10).fill(8); // 8 = garbage block
      const hole = Math.floor(Math.random() * 10);
      garbageRow[hole] = 0;
      board.push(garbageRow);
    }
  }

  getGarbageCount(lines) {
    if (lines === 2) return 1;
    if (lines === 3) return 2;
    if (lines === 4) return 4;
    return 0;
  }

  calculateScore(lines) {
    const scores = [0, 100, 300, 500, 800];
    return scores[lines] || 0;
  }

  checkTopOut(board) {
    // Top-out if anything is in the top 2 rows
    return board[19].some(cell => cell !== 0) || board[18].some(cell => cell !== 0);
  }

  hash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }
}

// Export for VM
module.exports = TetrisDuel;
