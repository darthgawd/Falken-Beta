import * as fs from 'fs';
import chalk from 'chalk';

/**
 * Falken Logic Sanitizer
 * Enforces compliance with FALKEN_VM_GAME_DESIGN.md
 */
export class LogicSanitizer {
  private bannedKeywords = [
    'Math.random',
    'Date.now',
    'performance.now',
    'fetch',
    'XMLHttpRequest',
    'eval(',
    'Function(',
    'setTimeout',
    'setInterval',
    'async ',
    'await '
  ];

  private requiredMethods = ['init', 'processMove', 'checkResult'];

  /**
   * Performs a comprehensive multi-stage audit of the logic file.
   */
  async sanitize(filePath: string): Promise<{ success: boolean; errors: string[] }> {
    const errors: string[] = [];
    const code = fs.readFileSync(filePath, 'utf8');

    console.log(chalk.gray(`  🔍 Auditing: ${filePath}...`));

    // 1. Static Analysis: Banned Keywords
    for (const word of this.bannedKeywords) {
      if (code.includes(word)) {
        errors.push(`BANNED_KEYWORD_DETECTED: Use of '${word}' is strictly prohibited for determinism.`);
      }
    }

    // 2. Structural Analysis: Required SDK Methods
    // We look for method definitions: method(args)
    for (const method of this.requiredMethods) {
      const regex = new RegExp(`${method}\\s*\\(`, 'g');
      if (!regex.test(code)) {
        errors.push(`MISSING_SDK_METHOD: The logic must implement '${method}()'.`);
      }
    }

    // 3. Security Analysis: Require module.exports or export default
    if (!code.includes('module.exports') && !code.includes('export default')) {
      errors.push('INVALID_EXPORT: Logic must use module.exports or export default class.');
    }

    // 4. Determinism Hint: Check for LCG pattern if Math.random is missing
    if (!code.includes('Math.imul')) {
      console.log(chalk.yellow('  ⚠️  Warning: No Math.imul detected. Ensure you are using a deterministic LCG for randomness.'));
    }

    return {
      success: errors.length === 0,
      errors
    };
  }
}
