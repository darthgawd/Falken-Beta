import { GameResult, GameMove, MatchContext } from '@falken/logic-sdk';
import pino from 'pino';

const logger = (pino as any)({ name: 'falken-referee-v4' });

/**
 * Round winner result type:
 * - 0 to N-1: Index of winning player in the players array
 * - 255: Draw
 * - null: Pending
 */
export type RoundWinner = number | null;

/**
 * Split pot result for games like Omaha Hi-Lo
 */
export type SplitResult = {
  winnerIndices: number[];
  splitBps: number[];
};

export type RoundResolution = {
  winner: RoundWinner;
  splitResult?: SplitResult;
  description: string;
};

/**
 * Falken VM: The Referee (V4)
 * Securely executes JS game logic to settle on-chain matches.
 * Hardened for N-player scalability and multi-street poker.
 * Supports split pot resolution for complex games.
 */
export class Referee {
  /**
   * Resolves a single round of a FISE match.
   * V4: Now supports split pot results from JS game logic.
   */
  async resolveRound(jsCode: string, context: MatchContext, moves: GameMove[]): Promise<RoundResolution | null> {
    const currentRound = moves[0]?.round || 1;
    const street = (context.config as any)?.street ?? 0;
    const maxStreets = (context.config as any)?.maxStreets ?? 1;

    logger.info({
      playersCount: context.players?.length || 2,
      round: currentRound,
      street,
      maxStreets,
      movesCount: moves.length
    }, 'INITIATING_ROUND_RESOLUTION');

    try {
      // Transform ES6 module syntax to CommonJS for safe evaluation
      const transformedCode = this.transformJsCode(jsCode);

      const runLogic = new Function('context', 'moves', `
        let GameClass;
        const exports = {};
        const module = { exports };

        ${transformedCode}

        GameClass = module.exports;

        if (!GameClass) {
          const classMatch = /class\s+(\w+)/.exec(\`${jsCode.replace(/`/g, '\`')}\`);
          if (classMatch && classMatch[1]) {
            GameClass = eval(classMatch[1]);
          }
        }

        if (!GameClass) throw new Error("Could not find Game Class in logic");

        const game = new GameClass();
        let state = game.init(context);

        for (const move of moves) {
          state = game.processMove(state, move);
        }

        const result = game.checkResult(state);
        const description = game.describeState ? game.describeState(state) : "";
        return { result, description };
      `);

      const rawResult = runLogic(context, moves);

      if (!rawResult) return null;

      logger.info({ result: rawResult.result, description: rawResult.description, round: currentRound }, 'ROUND_EXECUTION_RESULT');

      // V4: Handle both single winner and split pot results
      const normalized = this.normalizeResult(rawResult.result, context);

      return {
        winner: normalized.winner,
        splitResult: normalized.splitResult,
        description: rawResult.description || ""
      };

    } catch (err: any) {
      logger.error({ err: err.message, round: currentRound }, 'ROUND_RESOLUTION_FAULT');
      throw err;
    }
  }

  private transformJsCode(jsCode: string): string {
    // Extract default class name
    const defaultClassMatch = jsCode.match(/export\s+default\s+class\s+(\w+)/);
    const className = defaultClassMatch ? defaultClassMatch[1] : null;

    let transformed = jsCode
      .replace(/export\s*\{\s*(\w+)\s+as\s+default\s*\};?/g, 'module.exports = $1;')
      .replace(/export\s+default\s+class\s+(\w+)/g, 'class $1')
      .replace(/export\s+class\s+(\w+)/g, 'class $1')
      .replace(/export\s+\{[^}]*\};?/g, '')
      .replace(/export\s+/g, '');

    // Add module.exports assignment for default class
    if (className) {
      transformed += `\nmodule.exports = ${className};`;
    }

    return transformed;
  }

  /**
   * V4: Normalizes game result to handle both single winner and split pot.
   * Returns object with winner and optional splitResult.
   */
  private normalizeResult(result: any, context: MatchContext): { winner: RoundWinner; splitResult?: SplitResult } {
    // Check for split pot result first
    if (result && typeof result === 'object') {
      // Handle { winners: [...], splitBps: [...] } format
      if (Array.isArray(result.winners) && Array.isArray(result.splitBps)) {
        logger.info({ winners: result.winners, splitBps: result.splitBps }, 'SPLIT_POT_DETECTED');
        return {
          winner: 255, // 255 indicates split pot
          splitResult: {
            winnerIndices: result.winners,
            splitBps: result.splitBps
          }
        };
      }

      // Handle { winnerIndices: [...], splitBps: [...] } format
      if (Array.isArray(result.winnerIndices) && Array.isArray(result.splitBps)) {
        logger.info({ winnerIndices: result.winnerIndices, splitBps: result.splitBps }, 'SPLIT_POT_DETECTED');
        return {
          winner: 255,
          splitResult: {
            winnerIndices: result.winnerIndices,
            splitBps: result.splitBps
          }
        };
      }
    }

    // 255 is the protocol standard for DRAW
    if (result === 255 || result === 'draw' || result === 'DRAW') {
      return { winner: 255 };
    }

    if (typeof result === 'number') {
      // Support legacy 1-indexed results (1 or 2) from older game logic
      // BUT only if the result is >= number of players (meaning it's 1-indexed)
      // For 2 players: result 1 or 2 means 1-indexed, convert to 0 or 1
      // For N players: result should already be 0-indexed (0 to N-1)
      const playerCount = context.players?.length || 2;
      if (result >= 1 && result <= playerCount && result > playerCount - 1) {
        return { winner: result - 1 }; // Convert 1-indexed to 0-indexed
      }
      return { winner: result }; // Already 0-indexed (0, 1, 2, etc.)
    }

    if (typeof result === 'string') {
      const lower = result.toLowerCase().trim();
      if (lower === 'a' || lower === 'playera') return { winner: 0 };
      if (lower === 'b' || lower === 'playerb') return { winner: 1 };

      // Check if it's a player address
      const idx = context.players?.findIndex(p => p.toLowerCase() === lower);
      if (idx !== undefined && idx !== -1) return { winner: idx };
    }

    logger.warn({ result }, 'Unrecognized game result, defaulting to draw');
    return { winner: 255 };
  }
}
