/**
 * ShowdownBlitzPokerV4 - Falken FISE Game Logic
 * Optimized for V4 PokerEngine (bytes32 moves + multi-street support).
 * Version: V4.1 (Force CID Generation)
 */

export default class ShowdownBlitzPokerV4 {
  /**
   * Initialize the game state
   */
  init(ctx) {
    const players = (ctx.players || []).map(p => p.toLowerCase());
    return {
      matchId: ctx.matchId,
      playerA: players[0],
      playerB: players[1],
      players: players,
      discards: {}, // { address: [indices] }
      hands: {},    // { address: [cards] }
      complete: false,
      result: null  // 0=P1, 1=P2, 255=Draw
    };
  }

  /**
   * Process a player move
   */
  processMove(state, move) {
    if (state.complete) return state;
    
    const player = move.player.toLowerCase();
    const isPlayerA = player === state.playerA;
    
    // Generate deck from V4 Seed logic
    const deck = this.generateDeck(state.matchId + "_" + move.round);
    const initialHand = isPlayerA ? deck.slice(0, 5) : deck.slice(5, 10);

    // V4 COMPATIBILITY: Parse bytes32 hex string safely
    const moveData = (move.moveData || "0").toString();
    let moveVal;
    if (moveData.startsWith('0x')) {
        try {
            // Use BigInt for 32-byte hex strings to avoid precision loss
            // We only care about the lower 32 bits for the poker bitmask
            moveVal = Number(BigInt(moveData) & BigInt(0xFFFFFFFF)); 
        } catch (e) {
            moveVal = 0;
        }
    } else {
        moveVal = parseInt(moveData, 10) || 0;
    }

    // Bitmask encoding: each bit 0-4 represents a card index to discard
    const discardIndices = [];
    if (moveVal !== 99 && moveVal !== 0) {
      for (let i = 0; i < 5; i++) {
        if (moveVal & (1 << i)) discardIndices.push(i);
      }
    }
    state.discards[player] = discardIndices;
    
    let finalHand = [...initialHand];
    const replacementOffset = isPlayerA ? 10 : 15;
    discardIndices.forEach((idx, i) => {
      if (idx >= 0 && idx < 5) {
        finalHand[idx] = deck[replacementOffset + i];
      }
    });

    state.hands[player] = finalHand;

    // Check if showdown is ready
    if (state.hands[state.playerA] && state.hands[state.playerB]) {
      state.complete = true;
      state.result = this.evaluateWinner(state);
    }

    return state;
  }

  generateDeck(seedStr) {
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
      hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);
      hash |= 0;
    }
    const deck = Array.from({ length: 52 }, (_, i) => i);
    for (let i = deck.length - 1; i > 0; i--) {
      hash = (Math.imul(1664525, hash) + 1013904223) | 0;
      const j = Math.abs(hash % (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  evaluateWinner(state) {
    const scoreA = this.calculateHandStrength(state.hands[state.playerA]);
    const scoreB = this.calculateHandStrength(state.hands[state.playerB]);
    if (scoreA > scoreB) return 0; // P1 wins
    if (scoreB > scoreA) return 1; // P2 wins
    return 255; // Draw
  }

  calculateHandStrength(hand) {
    const ranks = hand.map(c => c % 13).sort((a, b) => b - a);
    const suits = hand.map(c => Math.floor(c / 13));
    const counts = {};
    ranks.forEach(r => counts[r] = (counts[r] || 0) + 1);
    const sortedCounts = Object.entries(counts)
      .map(([rank, count]) => [Number(rank), count])
      .sort((a, b) => b[1] - a[1] || b[0] - a[0]);

    const isFlush = suits.every(s => s === suits[0]);
    let isStraight = true;
    for (let i = 0; i < ranks.length - 1; i++) {
      if (ranks[i] !== ranks[i + 1] + 1) {
        if (!(i === 0 && ranks[0] === 12 && ranks[1] === 3)) { // Wheel check
          isStraight = false;
          break;
        }
      }
    }

    let rank = 0; // High Card
    if (isStraight && isFlush) rank = 8;
    else if (sortedCounts[0][1] === 4) rank = 7;
    else if (sortedCounts[0][1] === 3 && sortedCounts[1][1] === 2) rank = 6;
    else if (isFlush) rank = 5;
    else if (isStraight) rank = 4;
    else if (sortedCounts[0][1] === 3) rank = 3;
    else if (sortedCounts[0][1] === 2 && sortedCounts[1][1] === 2) rank = 2;
    else if (sortedCounts[0][1] === 2) rank = 1;

    let score = rank * Math.pow(16, 5);
    for (let i = 0; i < sortedCounts.length; i++) {
      score += sortedCounts[i][0] * Math.pow(16, 4 - i);
    }
    return score;
  }

  describeState(state) {
    if (!state.complete) return "Round in progress...";
    const labels = ["High Card", "Pair", "Two Pair", "Three of a Kind", "Straight", "Flush", "Full House", "Four of a Kind", "Straight Flush"];
    const scoreA = this.calculateHandStrength(state.hands[state.playerA]);
    const scoreB = this.calculateHandStrength(state.hands[state.playerB]);
    const rankA = Math.floor(scoreA / Math.pow(16, 5));
    const rankB = Math.floor(scoreB / Math.pow(16, 5));
    return `Player A has ${labels[rankA]}, Player B has ${labels[rankB]}`;
  }
}
