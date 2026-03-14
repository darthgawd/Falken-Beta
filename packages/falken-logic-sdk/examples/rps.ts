import { FalkenGame, FalkenResult, MatchContext, GameMove } from '../src/index';

/**
 * Example: Standard Rock-Paper-Scissors implemented via FISE V4.
 */

interface RPSState {
  players: string[];
  moves: Record<number, { a?: number; b?: number }>;
  currentRound: number;
  scoreA: number;
  scoreB: number;
  winsRequired: number;
}

export class RockPaperScissors extends FalkenGame<RPSState> {
  
  init(ctx: MatchContext): RPSState {
    return {
      players: ctx.players.map(p => p.toLowerCase()),
      moves: {},
      currentRound: 1,
      scoreA: 0,
      scoreB: 0,
      winsRequired: ctx.config?.winsRequired || 1
    };
  }

  processMove(state: RPSState, move: GameMove): RPSState {
    const { round, player, moveData } = move;
    
    // Parse bytes32 moveData to a number (0, 1, or 2)
    let moveValue = 0;
    if (typeof moveData === 'string' && moveData.startsWith('0x')) {
        moveValue = parseInt(moveData, 16);
    } else {
        moveValue = Number(moveData);
    }

    // Initialize round if not exists
    if (!state.moves[round]) state.moves[round] = {};

    // Assign move to the correct player
    if (player.toLowerCase() === state.players[0]) {
      state.moves[round].a = moveValue;
    } else {
      state.moves[round].b = moveValue;
    }

    // Check if round is complete
    const r = state.moves[round];
    if (r.a !== undefined && r.b !== undefined) {
      // Logic: 0=Rock, 1=Paper, 2=Scissors
      if (r.a === r.b) {
        // Draw, stay on round
      } else if (
        (r.a === 0 && r.b === 2) || // Rock beats Scissors
        (r.a === 1 && r.b === 0) || // Paper beats Rock
        (r.a === 2 && r.b === 1)    // Scissors beats Paper
      ) {
        state.scoreA++;
        state.currentRound++;
      } else {
        state.scoreB++;
        state.currentRound++;
      }
    }

    return state;
  }

  checkResult(state: RPSState): FalkenResult {
    if (state.scoreA >= state.winsRequired) {
        return { status: 'complete', winnerIndices: [0], description: `Player 1 wins ${state.scoreA} to ${state.scoreB}` };
    }
    if (state.scoreB >= state.winsRequired) {
        return { status: 'complete', winnerIndices: [1], description: `Player 2 wins ${state.scoreB} to ${state.scoreA}` };
    }
    return { status: 'pending', winnerIndices: [] };
  }
}
