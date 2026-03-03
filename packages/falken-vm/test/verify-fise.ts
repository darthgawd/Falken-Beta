import { Referee } from '../src/Referee';
import { MatchContext, GameMove } from '@falken/logic-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * FISE INTEGRATION TEST: VERIFY_BRAIN
 * Tests the full pipeline: SDK -> JS Logic -> Sandbox -> Result
 */
async function testReferee() {
  console.log('--- FISE INTEGRATION TEST STARTING ---');

  const referee = new Referee();

  // 1. Mock the Game Logic (Pure JS)
  // In a real match, this is fetched from IPFS
  const jsCode = `
    class RockPaperScissors {
      init(ctx) {
        return { playerA: ctx.playerA, playerB: ctx.playerB, score: 0, rounds: {} };
      }
      processMove(state, move) {
        if (!state.rounds[move.round]) state.rounds[move.round] = {};
        if (move.player === state.playerA) state.rounds[move.round].a = move.moveData;
        else state.rounds[move.round].b = move.moveData;

        // Resolve if round complete
        const r = state.rounds[move.round];
        if (r.a !== undefined && r.b !== undefined) {
          if (r.a === 1 && r.b === 3) state.score += 1;
          else if (r.a === 3 && r.b === 1) state.score -= 1;
          // ... rest of RPS logic ...
        }
        return state;
      }
      checkResult(state) {
        if (state.score >= 1) return 1; // Player A Wins
        if (state.score <= -1) return 2; // Player B Wins
        return 0;
      }
    }
  `;

  // 2. Mock Match Context
  const context: MatchContext = {
    playerA: '0x1111111111111111111111111111111111111111',
    playerB: '0x2222222222222222222222222222222222222222',
    stake: BigInt(1000000000000000) // 0.001 ETH
  };

  // 3. Mock Move History (Player A plays Rock, Player B plays Scissors)
  const moves: GameMove[] = [
    { player: context.playerA, moveData: 1, round: 1 },
    { player: context.playerB, moveData: 3, round: 1 }
  ];

  console.log('STATUS: Feeding mock match into Referee sandbox...');

  try {
    const winner = await referee.resolveMatch(jsCode, context, moves);

    if (winner === context.playerA) {
      console.log('✅ TEST PASSED: Referee correctly identified Player A as the winner.');
    } else {
      console.log('❌ TEST FAILED: Referee returned incorrect winner:', winner);
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ TEST CRASHED: Sandbox error:', err);
    process.exit(1);
  }

  console.log('--- INTEGRATION TEST COMPLETE ---');
}

testReferee();
