import { GameResult, GameMove, MatchContext } from '@falken/logic-sdk';
import pino from 'pino';
import { getQuickJS, QuickJSContext } from 'quickjs-emscripten';

const logger = (pino as any)({ name: 'falken-referee-v4' });

export type RoundWinner = number | null;
export type SplitResult = { winnerIndices: number[]; splitBps: number[]; };
export type RoundResolution = { winner: RoundWinner; splitResult?: SplitResult; description: string; };

/**
 * Falken VM: The Referee (V4)
 * Securely executes JS game logic using QuickJS (WASM Sandbox).
 * ZERO access to host system, process, or filesystem.
 */
export class Referee {
  /**
   * Resolves a single round of a FISE match.
   */
  async resolveRound(jsCode: string, context: MatchContext, moves: GameMove[]): Promise<RoundResolution | null> {
    const currentRound = moves[0]?.round || 1;
    const street = (context.config as any)?.street ?? 0;
    const maxStreets = (context.config as any)?.maxStreets ?? 1;

    logger.info({ players: context.players?.length, round: currentRound, street }, 'INITIATING_WASM_SANDBOX_RESOLUTION');

    try {
      const QuickJS = await getQuickJS();
      const vm = QuickJS.newContext();

      try {
        // 1. Transform ES6 to a format QuickJS can execute
        const transformedCode = this.transformJsCode(jsCode);
        logger.info({ transformedCode: transformedCode.substring(0, 200) + "..." + transformedCode.substring(transformedCode.length - 100) }, 'TRANSFORMED_CODE_DEBUG');
        
        logger.info({ transformedSnippet: transformedCode.substring(0, 100) + "..." }, "DEBUG_TRANSFORMED_CODE");

        // 2. Inject Context and Moves as Global JSON
        vm.setProp(vm.global, 'contextJson', vm.newString(JSON.stringify(context)));
        vm.setProp(vm.global, 'movesJson', vm.newString(JSON.stringify(moves)));

        // 3. Execution Wrapper
        const script = `
          try {
            const context = JSON.parse(contextJson);
            const moves = JSON.parse(movesJson);
            
            // Execute the transformed code which returns the GameClass via IIFE
            const GameClass = ${transformedCode};
            
            if (typeof GameClass !== 'function') {
               throw new Error("GameClass is not a function: " + typeof GameClass + ", value: " + String(GameClass));
            }

            const game = new GameClass();
            
            if (typeof game.init !== 'function') {
               throw new Error("game.init is not a function: " + typeof game.init);
            }
            
            let state = game.init(context);

            for (const move of moves) {
              if (typeof game.processMove !== 'function') {
                 throw new Error("game.processMove is not a function: " + typeof game.processMove);
              }
              state = game.processMove(state, move);
            }

            // Support both checkResult (standard) and evaluateWinner (poker-specific)
            const checkResultFn = game.checkResult || game.evaluateWinner;
            if (typeof checkResultFn !== 'function') {
               throw new Error("game has no checkResult or evaluateWinner method");
            }
            
            const result = checkResultFn.call(game, state);
            const description = game.describeState ? game.describeState(state) : "";
            
            JSON.stringify({ result, description });
          } catch (e) {
            throw new Error("SANDBOX_ERROR: " + e.message + " at " + e.stack);
          }
        `;

        const result = vm.evalCode(script);

        if (result.error) {
          const error = vm.dump(result.error);
          result.error.dispose();
          throw new Error(`SANDBOX_EXECUTION_ERROR: ${error.message || error}`);
        }

        const rawResultString = vm.getString(result.value);
        result.value.dispose();
        
        const rawResult = JSON.parse(rawResultString);
        if (!rawResult) return null;

        logger.info({ result: rawResult.result, round: currentRound }, 'SANDBOX_SUCCESS');

        const normalized = this.normalizeResult(rawResult.result, context);
        return {
          winner: normalized.winner,
          splitResult: normalized.splitResult,
          description: rawResult.description || ""
        };

      } finally {
        vm.dispose(); // CRITICAL: Free WASM memory
      }

    } catch (err: any) {
      logger.error({ err: err.message, stack: err.stack, round: currentRound }, 'ROUND_RESOLUTION_FAULT');
      throw err;
    }
  }

  private transformJsCode(jsCode: string): string {
    let transformed = jsCode;

    // Find the class name from various patterns
    let className: string | null = null;
    
    // 1. Check for bundled export pattern: export { Name as default }
    const bundleExportMatch = transformed.match(/export\s*\{\s*(\w+)\s+as\s+default\s*\}/);
    if (bundleExportMatch) {
      className = bundleExportMatch[1];
      transformed = transformed.replace(bundleExportMatch[0], '');
    }
    
    // 2. Check for: var Name=class{...}
    if (!className) {
      const varClassMatch = transformed.match(/var\s+(\w+)\s*=\s*class\s*[{\s]/);
      if (varClassMatch) {
        className = varClassMatch[1];
      }
    }
    
    // 3. Check for: export default class Name
    if (!className) {
      const defaultClassMatch = transformed.match(/export\s+default\s+class\s+(\w+)/);
      if (defaultClassMatch) {
        className = defaultClassMatch[1];
        transformed = transformed.replace(/export\s+default\s+class/, 'class');
      }
    }
    
    // 4. Check for: export class Name  
    if (!className) {
      const namedClassMatch = transformed.match(/export\s+class\s+(\w+)/);
      if (namedClassMatch) {
        className = namedClassMatch[1];
        transformed = transformed.replace(/export\s+class/, 'class');
      }
    }

    // Remove all export keywords
    transformed = transformed.replace(/\bexport\b/g, '');
    
    // If we found a class name, wrap the code to return it
    if (className) {
      // Wrap in IIFE that returns the class
      transformed = `(function() { ${transformed}; return ${className}; })()`;
    }
    
    return transformed;
  }

  private normalizeResult(result: any, context: MatchContext): { winner: RoundWinner; splitResult?: SplitResult } {
    if (result && typeof result === 'object' && (result.winnerIndices || result.winners)) {
      const winnerIndices = result.winnerIndices || result.winners;
      return {
        winner: 255,
        splitResult: {
          winnerIndices,
          splitBps: result.splitBps || winnerIndices.map(() => 10000 / winnerIndices.length)
        }
      };
    }

    if (result === 255 || result === 'draw') return { winner: 255 };

    if (typeof result === 'number') {
      // V4: Logic already returns 0-indexed (0=P1, 1=P2). 
      // Do not subtract 1 or we flip the winner!
      return { winner: result };
    }

    return { winner: 255 };
  }
}
