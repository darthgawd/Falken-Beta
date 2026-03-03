/**
 * RockPaperScissorsJS - Falken FISE Game Logic
 * A classic RPS implementation in JavaScript.
 * Moves: 0=Rock, 1=Paper, 2=Scissors
 */

export default class RockPaperScissorsJS {
  /**
   * Initialize the game state
   * @param {Object} ctx - Context with playerA, playerB, stake
   */
  init(ctx) {
    return {
      matchId: ctx.matchId,
      playerA: ctx.playerA.toLowerCase(),
      playerB: ctx.playerB.toLowerCase(),
      stake: ctx.stake,
      moves: {}, // { "0xaddress": move }
      result: 0, // 0=Pending, 1=A Wins, 2=B Wins, 3=Draw
      complete: false
    };
  }

  /**
   * Process a player move
   * @param {Object} state - Current game state
   * @param {Object} move - { player, moveData, round }
   */
  processMove(state, move) {
    if (state.complete) return state;
    
    const player = move.player.toLowerCase();
    const moveValue = parseInt(move.moveData, 10);

    // Record the move
    state.moves[player] = moveValue;

    // Check if both players moved
    const moveA = state.moves[state.playerA];
    const moveB = state.moves[state.playerB];

    if (moveA !== undefined && moveB !== undefined) {
      state.complete = true;
      state.result = this.checkResult(state);
    }

    return state;
  }

  /**
   * Check the game result
   * 0=Pending, 1=A Wins, 2=B Wins, 3=Draw
   */
  checkResult(state) {
    const moveA = state.moves[state.playerA];
    const moveB = state.moves[state.playerB];

    if (moveA === undefined || moveB === undefined) return 0;
    if (moveA === moveB) return 3;

    // RPS Logic: (moveA + 1) % 3 === moveB means B wins
    if ((moveA + 1) % 3 === moveB) {
      return 2; // Player B wins
    } else {
      return 1; // Player A wins
    }
  }

  describeState(state) {
    const labels = ['ROCK', 'PAPER', 'SCISSORS'];
    const moveA = state.moves[state.playerA] !== undefined ? labels[state.moves[state.playerA]] : 'WAITING';
    const moveB = state.moves[state.playerB] !== undefined ? labels[state.moves[state.playerB]] : 'WAITING';
    return `RPS Match: A(${moveA}) vs B(${moveB})`;
  }
}
