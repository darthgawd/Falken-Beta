import { FalkenGame, GameResult, MatchContext, GameMove } from '../src/index';

/**
 * Example: Standard Rock-Paper-Scissors implemented via FISE.
 */

interface RPSState {
  playerA: string;
  playerB: string;
  moves: Record<number, { a?: number; b?: number }>;
  currentRound: number;
  scoreA: number;
  winsRequired: number;
}

export class RockPaperScissors extends FalkenGame<RPSState> {
  
  init(ctx: MatchContext): RPSState {
    return {
      playerA: ctx.playerA,
      playerB: ctx.playerB,
      moves: {},
      currentRound: 1,
      scoreA: 0,
      winsRequired: ctx.config?.winsRequired || 1
    };
  }

  processMove(state: RPSState, move: GameMove): RPSState {
    const { round, player, moveData } = move;
    const moveValue = typeof moveData === 'number' ? moveData : parseInt(moveData as string);

    // Initialize round if not exists
    if (!state.moves[round]) state.moves[round] = {};

    // Assign move to the correct player
    if (player === state.playerA) {
      state.moves[round].a = moveValue;
    } else {
      state.moves[round].b = moveValue;
    }

    // Check if round is complete
    const r = state.moves[round];
    if (r.a !== undefined && r.b !== undefined) {
      // Logic: 1=Rock, 2=Paper, 3=Scissors
      if (r.a === r.b) {
        // Draw, stay on round
      } else if (
        (r.a === 1 && r.b === 3) || // Rock beats Scissors
        (r.a === 2 && r.b === 1) || // Paper beats Rock
        (r.a === 3 && r.b === 2)    // Scissors beats Paper
      ) {
        state.scoreA++;
        state.currentRound++;
      } else {
        state.scoreA--;
        state.currentRound++;
      }
    }

    return state;
  }

  checkResult(state: RPSState): GameResult {
    if (state.scoreA >= state.winsRequired) return GameResult.PLAYER_A_WINS;
    if (state.scoreA <= -state.winsRequired) return GameResult.PLAYER_B_WINS;
    return GameResult.PENDING;
  }

  describeState(state: RPSState): string {
    return `ROUND_${state.currentRound} // SCORE: ${state.scoreA}`;
  }
}
