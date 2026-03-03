import ShowdownBlitzPoker from '../poker.js';

async function verifyScoring() {
  console.log('--- VERIFYING POKER SCORING FIX ---');
  const logic = new ShowdownBlitzPoker();

  // Card IDs: Rank + (Suit * 13)
  // Suit order: 0=Clubs, 1=Diamonds, 2=Hearts, 3=Spades
  
  // Hand A: Ace High (A-Hearts, K-Clubs, 7-Clubs, J-Hearts, Q-Spades)
  // Ranks: 12, 11, 5, 9, 10
  const handA = [12 + 2*13, 11 + 0*13, 5 + 0*13, 9 + 2*13, 10 + 3*13];
  
  // Hand B: Pair of Queens (K-Diamonds, Q-Spades, 9-Spades, A-Clubs, Q-Clubs)
  // Ranks: 11, 10, 7, 12, 10
  const handB = [11 + 1*13, 10 + 3*13, 7 + 3*13, 12 + 0*13, 10 + 0*13];

  const scoreA = logic.calculateHandStrength(handA);
  const scoreB = logic.calculateHandStrength(handB);

  console.log(`Player A (Ace High) Score: ${scoreA.toString(16).toUpperCase()}`);
  console.log(`Player B (Pair of Qs) Score: ${scoreB.toString(16).toUpperCase()}`);

  if (scoreB > scoreA) {
    console.log('\n✅ SUCCESS: Pair of Queens correctly beats Ace High.');
    console.log(`Difference: 0x${(scoreB - scoreA).toString(16).toUpperCase()}`);
  } else {
    console.error('\n❌ FAILURE: Ace High still beating Pair of Queens!');
    process.exit(1);
  }
}

verifyScoring().catch(console.error);
