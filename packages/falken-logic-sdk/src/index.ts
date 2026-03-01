import { z } from 'zod';

/**
 * Falken Immutable Scripting Engine (FISE)
 * Core Game Interface Standard V1.0
 */

export enum GameResult {
  PENDING = 0,
  PLAYER_A_WINS = 1,
  PLAYER_B_WINS = 2,
  DRAW = 3
}

export interface MatchContext {
  matchId: string;
  playerA: string;
  playerB: string;
  stake: bigint;
  config?: Record<string, any>;
}

export interface GameMove {
  player: string;
  moveData: number | string | Record<string, any>;
  round: number;
  salt?: string;
}

/**
 * Every Falken JS game must extend this base class.
 * This ensures the Falken VM can run the logic deterministically.
 */
export abstract class FalkenGame<TState = any> {
  /**
   * Initialize the game state.
   */
  abstract init(ctx: MatchContext): TState;

  /**
   * Process a new move and return the updated state.
   */
  abstract processMove(state: TState, move: GameMove): TState;

  /**
   * Determine if the game has reached a terminal state.
   */
  abstract checkResult(state: TState): GameResult;

  /**
   * Optional: Provide a human-readable summary of the current state.
   * Useful for the Terminal and Intel Lens.
   */
  describeState?(state: TState): string;
}

/**
 * Helper to validate move data using Zod.
 */
export const createMoveValidator = (schema: z.ZodType<any>) => {
  return (data: any) => schema.parse(data);
};
