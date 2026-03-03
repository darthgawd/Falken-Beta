import ShowdownBlitzPoker from '../poker.js';

function test() {
  const logic = new ShowdownBlitzPoker();

  function getHand(ranks, suits) {
    return ranks.map((r, i) => suits[i] * 13 + r);
  }

  const cases = [
    {
      name: "Pair of Kings vs Pair of Queens",
      handA: getHand([11, 11, 5, 4, 3], [0, 1, 0, 1, 2]), // Pair of Kings (rank 11)
      handB: getHand([10, 10, 9, 8, 7], [0, 1, 0, 1, 2]), // Pair of Queens (rank 10)
      expected: 1
    },
    {
      name: "Pair of Aces, K kicker vs Pair of Aces, Q kicker",
      handA: getHand([12, 12, 11, 4, 3], [0, 1, 0, 1, 2]), // Pair of Aces, King kicker
      handB: getHand([12, 12, 10, 9, 8], [0, 1, 0, 1, 2]), // Pair of Aces, Queen kicker
      expected: 1
    },
    {
      name: "Two Pair (K, 2) vs Two Pair (Q, J)",
      handA: getHand([11, 11, 0, 0, 5], [0, 1, 0, 1, 2]), // Kings and 2s
      handB: getHand([10, 10, 9, 9, 8], [0, 1, 0, 1, 2]), // Queens and Jacks
      expected: 1
    },
    {
      name: "Two Pair (A, 2) vs Two Pair (A, 3)",
      handA: getHand([12, 12, 0, 0, 5], [0, 1, 0, 1, 2]), // Aces and 2s
      handB: getHand([12, 12, 1, 1, 2], [0, 1, 2, 3, 0]), // Aces and 3s
      expected: 2
    },
    {
      name: "Ace-low Straight vs King-high High Card",
      handA: getHand([12, 0, 1, 2, 3], [0, 1, 0, 1, 0]), // A, 2, 3, 4, 5 (Straight)
      handB: getHand([11, 9, 8, 7, 5], [0, 1, 2, 3, 0]), // King-high
      expected: 1
    },
    {
      name: "Ace-high Straight vs King-high Straight",
      handA: getHand([12, 11, 10, 9, 8], [0, 1, 0, 1, 0]), // A, K, Q, J, 10
      handB: getHand([11, 10, 9, 8, 7], [0, 1, 0, 1, 0]), // K, Q, J, 10, 9
      expected: 1
    },
    {
        name: "Full House (3s over 2s) vs Full House (2s over As)",
        handA: getHand([1, 1, 1, 0, 0], [0, 1, 2, 0, 1]), // 3-3-3-2-2
        handB: getHand([0, 0, 0, 12, 12], [0, 1, 2, 0, 1]), // 2-2-2-A-A
        expected: 1
    },
    {
        name: "Four of a Kind (2s) vs Full House (As over Ks)",
        handA: getHand([0, 0, 0, 0, 12], [0, 1, 2, 3, 0]), // 2-2-2-2-A
        handB: getHand([12, 12, 12, 11, 11], [0, 1, 2, 0, 1]), // A-A-A-K-K
        expected: 1
    }
  ];

  cases.forEach(c => {
    const scoreA = logic.calculateHandStrength(c.handA);
    const scoreB = logic.calculateHandStrength(c.handB);
    let result = 3;
    if (scoreA > scoreB) result = 1;
    if (scoreB > scoreA) result = 2;

    if (result === c.expected) {
      console.log(`✅ PASSED: ${c.name}`);
    } else {
      console.error(`❌ FAILED: ${c.name}. Expected ${c.expected}, got ${result}`);
      console.error(`   Score A: ${scoreA.toString(16)}, Score B: ${scoreB.toString(16)}`);
    }
  });
}

test();
