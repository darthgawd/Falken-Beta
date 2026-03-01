/**
 * LiarsDiceJS - Falken FISE Game Logic (v4 - Multi-Turn Stable)
 */

export default class LiarsDiceJS {
  init(ctx) {
    return {
      playerA: (ctx.playerA || '').toLowerCase(),
      playerB: (ctx.playerB || '').toLowerCase(),
      stake: ctx.stake,
      round: 1,
      dice: {},
      bids: [],
      complete: false,
      result: 0,
      turn: (ctx.playerA || '').toLowerCase()
    };
  }

  generateDice(player, salt) {
    const seed = player.toLowerCase() + salt.toLowerCase();
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = ((hash << 5) - hash) + seed.charCodeAt(i);
      hash |= 0;
    }
    const dice = [];
    for (let i = 0; i < 5; i++) {
      hash = (Math.imul(1664525, hash) + 1013904223) | 0;
      dice.push(Math.abs(hash % 6) + 1);
    }
    return dice;
  }

  processMove(state, move) {
    if (state.complete || !move.player) return state;
    const player = move.player.toLowerCase();
    
    // Dice are tied to the players and their unique salts
    if (!state.dice[player] && move.salt) {
      state.dice[player] = this.generateDice(player, move.salt);
    }

    const moveVal = parseInt(move.moveData);
    if (isNaN(moveVal)) return state;

    if (moveVal === 0) {
      state.complete = true;
      state.result = this.evaluate(state, player);
    } else {
      const quantity = Math.floor(moveVal / 10);
      const face = moveVal % 10;
      if (quantity > 0 && face >= 1 && face <= 6) {
        state.bids.push({ player, quantity, face });
        state.turn = (player === state.playerA) ? state.playerB : state.playerA;
      }
    }
    return state;
  }

  evaluate(state, caller) {
    if (state.bids.length === 0) return 0;
    const lastBid = state.bids[state.bids.length - 1];
    const bidder = lastBid.player;
    
    let total = 0;
    Object.values(state.dice).forEach(hand => {
      hand.forEach(d => {
        if (d === lastBid.face || d === 1) total++;
      });
    });

    const bidderWon = total >= lastBid.quantity;
    if (bidderWon) {
      return (bidder === state.playerA) ? 1 : 2;
    } else {
      return (caller === state.playerA) ? 1 : 2;
    }
  }

  checkResult(state) {
    if (!state.complete) return 0;
    return state.result;
  }
}
