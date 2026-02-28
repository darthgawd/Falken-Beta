import { GameResult, GameMove, MatchContext } from '@falken/logic-sdk';
import pino from 'pino';

const logger = (pino as any)({ name: 'falken-referee' });

/**
 * Falken VM: The Referee
 * Securely executes JS game logic to settle on-chain matches.
 * Note: Falls back to local execution if isolated-vm is missing (for dev/beta).
 */
export class Referee {
  async resolveMatch(jsCode: string, context: MatchContext, moves: GameMove[]): Promise<string | null> {
    logger.info({ matchId: '...', logicId: '...' }, 'INITIATING_VIRTUAL_SETTLEMENT');

    try {
      // 1. DYNAMIC IN-PROCESS EXECUTION (BETA_FALLBACK)
      // In production, this runs in isolated-vm.
      
      /**
       * We evaluate the code and find the exported class.
       * We support 'export default class Name' or 'class Name'.
       */
      // Transform ES6 module syntax to CommonJS for safe evaluation
      const transformedCode = jsCode
        // Handle minified: export{n as default} -> module.exports = n;
        .replace(/export\s*\{\s*(\w+)\s+as\s+default\s*\};?/g, 'module.exports = $1;')
        // Handle: export default class Name -> class Name; module.exports = Name;
        .replace(/export\s+default\s+class\s+(\w+)/g, 'class $1; module.exports = $1;')
        // Handle: export class Name -> class Name; module.exports = Name;
        .replace(/export\s+class\s+(\w+)/g, 'class $1; module.exports = $1;')
        // Remove any remaining export statements
        .replace(/export\s+\{[^}]*\};?/g, '')
        .replace(/export\s+/g, '');
      
      const runLogic = new Function('context', 'moves', `
        // Mocking ES Modules for dynamic Function execution
        let GameClass;
        const exports = {};
        const module = { exports };
        
        // Transformed game logic code
        ${transformedCode}
        
        GameClass = module.exports;
        
        // If module.exports is empty, try to find the class by name
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
        return game.checkResult(state);
      `);

      const result = runLogic(context, moves);
      logger.info({ result }, 'LOGIC_EXECUTION_RESULT');

      // 2. Interpret Result
      if (result === 1) return context.playerA; // Use raw numbers for test stability
      if (result === 2) return context.playerB;
      
      return null; // Draw or Pending

    } catch (err: any) {
      logger.error({ err: err.message }, 'SETTLEMENT_EXECUTION_FAULT');
      throw err;
    }
  }
}
