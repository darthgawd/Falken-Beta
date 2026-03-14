import { FalkenGame, MatchContext, GameMove, FalkenResult, GameResult } from './index';

/**
 * Testing Utilities for Falken Logic SDK
 * These helpers allow developers to simulate and test their game logic
 * without needing the full FISE VM environment.
 */

export function createMockContext(overrides?: Partial<MatchContext>): MatchContext {
  return {
    matchId: '0xmock-1',
    players: ['0xPlayerA', '0xPlayerB'],
    stake: 1000000n, // 1 USDC
    round: 1,
    street: 0,
    maxStreets: 1,
    config: {},
    ...overrides
  };
}

export function createMockMove(overrides?: Partial<GameMove>): GameMove {
  return {
    player: '0xPlayerA',
    moveData: '0x0',
    round: 1,
    street: 0,
    salt: '0xmockSaltA',
    ...overrides
  };
}

export function simulate(game: FalkenGame, ctx: MatchContext, moves: GameMove[]): FalkenResult | GameResult {
  let state = game.init(ctx);
  
  for (const move of moves) {
    state = game.processMove(state, move);
  }
  
  return game.checkResult(state);
}
