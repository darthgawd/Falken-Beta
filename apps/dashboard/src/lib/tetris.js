/**
 * TETRIS DUEL (1v1 Adversarial)
 * SDK Compliance: V1.0 (Hardened)
 */

class TetrisDuel {
  /**
   * GameResult Constants (Matching @falken/logic-sdk)
   * 0: PENDING, 1: PLAYER_A_WINS, 2: PLAYER_B_WINS, 3: DRAW
   */
  RESULTS = { PENDING: 0, PLAYER_A_WINS: 1, PLAYER_B_WINS: 2, DRAW: 3 };

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
    let seedValue = this.hash(ctx.seed || ctx.matchId);
    const pieceTypes = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
    const bag = [];
    let currentSeed = seedValue;
    
    for (let i = 0; i < 1000; i++) {
      currentSeed = (Math.imul(1664525, currentSeed) + 1013904223) | 0;
      bag.push(pieceTypes[Math.abs(currentSeed % 7)]);
    }

    return {
      playerA: (ctx.playerA || '0x0000000000000000000000000000000000000000').toLowerCase(),
      playerB: (ctx.playerB || '0x0000000000000000000000000000000000000000').toLowerCase(),
      boardA: Array(20).fill(null).map(() => Array(10).fill(0)),
      boardB: Array(20).fill(null).map(() => Array(10).fill(0)),
      scoreA: 0,
      scoreB: 0,
      currentPieceIndex: 0,
      pieceBag: bag,
      gameOver: false,
      winner: this.RESULTS.PENDING,
      rounds: {},
      internalSeed: currentSeed
    };
  }

  processMove(state, move) {
    if (state.gameOver) return state;

    // Use move.round or default to 1 if missing
    const roundNum = move.round || 1;
    if (!state.rounds[roundNum]) state.rounds[roundNum] = {};
    
    const isA = move.player.toLowerCase() === state.playerA;
    if (isA) state.rounds[roundNum].a = move.moveData;
    else state.rounds[roundNum].b = move.moveData;

    const r = state.rounds[roundNum];
    if (r.a !== undefined && r.b !== undefined) {
      const pieceType = state.pieceBag[state.currentPieceIndex];
      const linesA = this.dropPiece(state.boardA, pieceType, r.a);
      const linesB = this.dropPiece(state.boardB, pieceType, r.b);

      const topOutA = this.checkTopOut(state.boardA);
      const topOutB = this.checkTopOut(state.boardB);

      if (topOutA || topOutB) {
        state.gameOver = true;
        if (topOutA && topOutB) {
          state.winner = state.scoreA > state.scoreB ? this.RESULTS.PLAYER_A_WINS : 
                        (state.scoreB > state.scoreA ? this.RESULTS.PLAYER_B_WINS : this.RESULTS.DRAW);
        } else {
          state.winner = topOutA ? this.RESULTS.PLAYER_B_WINS : this.RESULTS.PLAYER_A_WINS;
        }
        return state;
      }

      if (linesA >= 2) this.addGarbage(state, state.boardB, this.getGarbageCount(linesA));
      if (linesB >= 2) this.addGarbage(state, state.boardA, this.getGarbageCount(linesB));

      state.scoreA += this.calculateScore(linesA);
      state.scoreB += this.calculateScore(linesB);
      state.currentPieceIndex++;
    }

    return state;
  }

  checkResult(state) {
    return state.winner;
  }

  describeState(state) {
    if (state.gameOver) return `GAME_OVER: ${state.winner === 1 ? 'A_VICTORY' : (state.winner === 2 ? 'B_VICTORY' : 'DRAW')}`;
    return `PIECE_INDEX: ${state.currentPieceIndex} // SCORES: A=${state.scoreA} B=${state.scoreB}`;
  }

  // --- INTERNAL PHYSICS ---

  dropPiece(board, type, moveData) {
    const rotation = Math.floor(Number(moveData) / 10) % 4;
    const col = Number(moveData) % 10;
    const shape = this.getPieces()[type][rotation];
    const shapeW = shape[0].length;
    const shapeH = shape.length;
    const startCol = Math.max(0, Math.min(col, 10 - shapeW));

    let landingY = 19;
    for (let y = 19; y >= (shapeH - 1); y--) {
      if (this.canFit(board, shape, y, startCol)) landingY = y;
      else break;
    }

    for (let sy = 0; sy < shapeH; sy++) {
      for (let sx = 0; sx < shapeW; sx++) {
        if (shape[sy][sx] !== 0) {
          const boardY = landingY - (shapeH - 1 - sy);
          if (boardY >= 0 && boardY < 20) board[boardY][startCol + sx] = shape[sy][sx];
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
          if (boardY < 0 || boardY >= 20 || boardX < 0 || boardX >= 10 || board[boardY][boardX] !== 0) return false;
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

  addGarbage(state, board, count) {
    for (let i = 0; i < count; i++) {
      board.pop();
      const row = Array(10).fill(8);
      state.internalSeed = (Math.imul(1664525, state.internalSeed) + 1013904223) | 0;
      const hole = Math.abs(state.internalSeed % 10);
      row[hole] = 0;
      board.unshift(row);
    }
  }

  getGarbageCount(lines) {
    const table = { 2: 1, 3: 2, 4: 4 };
    return table[lines] || 0;
  }

  calculateScore(lines) {
    const scores = [0, 100, 300, 500, 800];
    return scores[lines] || 0;
  }

  checkTopOut(board) {
    return board[19].some(cell => cell !== 0) || board[18].some(cell => cell !== 0);
  }

  hash(str) {
    let h = 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    return h;
  }
}

module.exports = TetrisDuel;
