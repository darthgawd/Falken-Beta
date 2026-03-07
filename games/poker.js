/**
 * ShowdownBlitzPoker - Falken FISE Game Logic (v2 - Hardened)
 * 5-Card Draw, 1-Swap, Best-of-5 rounds.
 */

export default class ShowdownBlitzPoker {
  init(ctx) {
    const players = (ctx.players || []).map(p => p.toLowerCase());
    return {
      players,
      playerA: players[0] || '',
      playerB: players[1] || '',
      stake: ctx.stake,
      matchId: ctx.matchId,
      hands: {},
      discards: {},
      complete: false,
      result: 255 // Default to Draw
    };
  }

  processMove(state, move) {
    if (state.complete || !move.player) return state;
    const player = move.player.toLowerCase();
    
    const deck = this.generateDeck(state.matchId + "_" + move.round);
    
    const isPlayerA = player === state.playerA;
    const isPlayerB = player === state.playerB;
    if (!isPlayerA && !isPlayerB) return state;

    const initialHandOffset = isPlayerA ? 0 : 5;
    const initialHand = deck.slice(initialHandOffset, initialHandOffset + 5);
    
    const moveData = move.moveData.toString();
    const discardIndices = moveData === '99' ? [] : moveData.split('').map(Number);
    state.discards[player] = discardIndices;
    
    let finalHand = [...initialHand];
    const replacementOffset = isPlayerA ? 10 : 15;
    discardIndices.forEach((idx, i) => {
      if (idx >= 0 && idx < 5) {
        finalHand[idx] = deck[replacementOffset + i];
      }
    });

    state.hands[player] = finalHand;

    if (state.hands[state.playerA] && state.hands[state.playerB]) {
      state.complete = true;
      state.result = this.evaluateWinner(state);
    }

    return state;
  }

  evaluateWinner(state) {
    const scoreA = this.calculateHandStrength(state.hands[state.playerA]);
    const scoreB = this.calculateHandStrength(state.hands[state.playerB]);
    if (scoreA > scoreB) return 0; // Index of Player A
    if (scoreB > scoreA) return 1; // Index of Player B
    return 255; // Draw
  }

  calculateHandStrength(hand) {
    // Rank: 0=2, 1=3, ..., 11=K, 12=A
    const ranks = hand.map(c => c % 13).sort((a, b) => b - a);
    const suits = hand.map(c => Math.floor(c / 13));
    
    const counts = {};
    ranks.forEach(r => counts[r] = (counts[r] || 0) + 1);
    
    // Sort by frequency (desc), then by rank (desc)
    const sortedCounts = Object.entries(counts)
      .map(([rank, count]) => [Number(rank), count])
      .sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    
    const isFlush = new Set(suits).size === 1;
    
    // Straight detection
    let isStraight = false;
    let straightHighRank = -1;
    const isNormalStraight = ranks.every((r, i) => i === 0 || ranks[i-1] - r === 1);
    if (isNormalStraight) {
      isStraight = true;
      straightHighRank = ranks[0];
    } else if (ranks[0] === 12 && ranks[1] === 3 && ranks[2] === 2 && ranks[3] === 1 && ranks[4] === 0) {
      isStraight = true;
      straightHighRank = 3;
    }

    let handRank = 0; 
    if (isStraight && isFlush) handRank = 8;
    else if (sortedCounts[0][1] === 4) handRank = 7;
    else if (sortedCounts[0][1] === 3 && sortedCounts[1][1] === 2) handRank = 6;
    else if (isFlush) handRank = 5;
    else if (isStraight) handRank = 4;
    else if (sortedCounts[0][1] === 3) handRank = 3;
    else if (sortedCounts[0][1] === 2 && sortedCounts[1][1] === 2) handRank = 2;
    else if (sortedCounts[0][1] === 2) handRank = 1;

    // FIXED: Score packing [HandRank][Rank1][Rank2][Rank3][Rank4][Rank5]
    // HandRank is multiplied by 16^5 to stay at the top.
    let score = handRank * Math.pow(16, 5);
    
    if (isStraight) {
      score += straightHighRank * Math.pow(16, 4);
    } else {
      let power = 4;
      for (let i = 0; i < sortedCounts.length; i++) {
        const [rank, count] = sortedCounts[i];
        for (let j = 0; j < count; j++) {
          score += rank * Math.pow(16, power--);
        }
      }
    }

    return score;
  }

  checkResult(state) {
    if (!state.complete) return 0; // PENDING
    return state.result;
  }

  describeState(state) {
    const labels = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];
    const handA = state.hands[state.playerA];
    const handB = state.hands[state.playerB];
    if (!handA || !handB) return "Waiting for unmasking...";
    
    const scoreA = this.calculateHandStrength(handA);
    const scoreB = this.calculateHandStrength(handB);
    const rankA = Math.floor(scoreA / Math.pow(16, 5));
    const rankB = Math.floor(scoreB / Math.pow(16, 5));
    
    return `Player A has ${labels[rankA]}, Player B has ${labels[rankB]}`;
  }
}
