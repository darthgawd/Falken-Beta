import { GameResult, GameMove, MatchContext } from '@falken/logic-sdk';
import pino from 'pino';

const logger = (pino as any)({ name: 'falken-referee' });

/**
 * Round winner result type:
 * - 0: Draw
 * - 1: Player A wins
 * - 2: Player B wins
 * - null: Pending
 */
export type RoundWinner = 0 | 1 | 2 | null;

export type RoundResolution = {
  winner: RoundWinner;
  description: string;
};

/**
 * Falken VM: The Referee
 * Securely executes JS game logic to settle on-chain matches.
 */
export class Referee {
  /**
   * Resolves a single round of a FISE match.
   */
  async resolveRound(jsCode: string, context: MatchContext, moves: GameMove[]): Promise<RoundResolution | null> {
    const currentRound = moves[0]?.round || 1;
    logger.info({ 
      playerA: context.playerA.slice(0, 10) + '...',
      playerB: context.playerB.slice(0, 10) + '...',
      round: currentRound,
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
          const classMatch = /class\\s+(\\w+)/.exec(\`${jsCode.replace(/`/g, '\\`')}\`);
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

        const winner = game.checkResult(state);
        const description = game.describeState ? game.describeState(state) : "";
        return { winner, description };
      `);

      const result = runLogic(context, moves);
      
      if (!result || result.winner === 0) return null;

      logger.info({ winner: result.winner, description: result.description, round: currentRound }, 'ROUND_EXECUTION_RESULT');
      const normalizedWinner = this.normalizeResult(result.winner, context);
      return { winner: normalizedWinner, description: result.description || "" };

    } catch (err: any) {
      logger.error({ err: err.message, round: currentRound }, 'ROUND_RESOLUTION_FAULT');
      throw err;
    }
  }

  async resolveMatch(jsCode: string, context: MatchContext, moves: GameMove[]): Promise<string | null> {
    const currentRound = moves[0]?.round || 1;
    logger.info({ 
      playerA: context.playerA.slice(0, 10) + '...',
      playerB: context.playerB.slice(0, 10) + '...',
      round: currentRound 
    }, 'INITIATING_MATCH_RESOLUTION');

    try {
      const resolution = await this.resolveRound(jsCode, context, moves);
      if (resolution?.winner === 1) return context.playerA;
      if (resolution?.winner === 2) return context.playerB;
      return null;
    } catch (err: any) {
      logger.error({ err: err.message, round: currentRound }, 'MATCH_RESOLUTION_FAULT');
      throw err;
    }
  }

  private transformJsCode(jsCode: string): string {
    return jsCode
      .replace(/export\s*\{\s*(\w+)\s+as\s+default\s*\};?/g, 'module.exports = $1;')
      .replace(/export\s+default\s+class\s+(\w+)/g, 'class $1')
      .replace(/export\s+class\s+(\w+)/g, 'class $1')
      .replace(/export\s+\{[^}]*\};?/g, '')
      .replace(/export\s+/g, '');
  }

  private normalizeResult(result: any, context: MatchContext): RoundWinner {
    if (typeof result === 'number') {
      if (result === 0 || result === 1 || result === 2) return result as RoundWinner;
      if (result === 3) return 0;
    }
    if (typeof result === 'string') {
      const lower = result.toLowerCase().trim();
      if (lower === 'draw' || lower === '0' || lower === 'tie') return 0;
      if (lower === 'a' || lower === '1' || lower === 'playera') return 1;
      if (lower === 'b' || lower === '2' || lower === 'playerb') return 2;
      if (lower === context.playerA.toLowerCase()) return 1;
      if (lower === context.playerB.toLowerCase()) return 2;
    }
    logger.warn({ result }, 'Unrecognized game result, defaulting to draw');
    return 0;
  }
}
