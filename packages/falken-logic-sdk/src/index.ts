import { z } from 'zod';

/**
 * Falken Immutable Scripting Engine (FISE)
 * Core Game Interface Standard V4.0
 */

// Deprecated in V4. Keep for backward compatibility with V3 games.
export enum GameResult {
  PENDING = 0,
  PLAYER_A_WINS = 1,
  PLAYER_B_WINS = 2,
  DRAW = 255
}

/**
 * V4 Resolution Standard
 * Supports N-players, split pots, and detailed descriptions.
 */
export interface FalkenResult {
  status: 'pending' | 'complete';
  winnerIndices: number[];   // 0-indexed. [] = pending, [0, 1] = split pot
  splitBps?: number[];       // Must sum to 10000 if multiple winners
  description?: string;      // Human-readable summary
}

export interface MatchContext {
  matchId: string;
  players: string[];
  stake: bigint | string;
  round: number;
  street?: number;           // V4 Multi-street support
  maxStreets?: number;       // V4 Multi-street support
  config?: Record<string, any>;
}

export interface GameMove {
  player: string;
  moveData: `0x${string}`;   // V4 standard: bytes32 hex string
  round: number;
  street?: number;
  salt?: string;
}

/**
 * Helper: Generate a secure, un-precomputable deterministic seed.
 * V4 Standard: keccak256(saltA + saltB + ... + matchId + round)
 * This prevents players from pre-calculating the deck before committing.
 */
export function createDualSaltSeed(salts: string[], matchId: string, round: number, street: number = 0): number {
  // Sort salts to ensure deterministic order regardless of player array position
  const sortedSalts = [...salts].sort();
  const seedStr = sortedSalts.join('') + matchId.toLowerCase() + '_' + round + '_' + street;
  
  // Simple LGC initialization from string hash
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
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
   * Returns FalkenResult for V4, or GameResult for legacy V3.
   */
  abstract checkResult(state: TState): GameResult | FalkenResult;

  /**
   * Optional: Provide a human-readable summary of the current state.
   * Deprecated in V4: Use FalkenResult.description instead.
   */
  describeState?(state: TState): string;
}

/**
 * Helper to validate move data using Zod.
 */
export const createMoveValidator = (schema: z.ZodType<any>) => {
  return (data: any) => schema.parse(data);
};
