const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function main() {
  // Get matchId from command line argument, or default to 5
  const matchIdArg = process.argv[2];
  let matchId = matchIdArg ? parseInt(matchIdArg) : 5; 
  
  if (!process.env.AGENT_PRIVATE_KEY || !process.env.RPC_URL || !process.env.ESCROW_ADDRESS) {
    console.error('Missing required environment variables in .env');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  const escrowAddress = process.env.ESCROW_ADDRESS.toLowerCase();
  
  const escrowAbi = [
    "function revealMove(uint256 _matchId, uint8 _move, bytes32 _salt)",
    "function getMatch(uint256 _matchId) view returns (tuple(address playerA, address playerB, uint256 stake, address gameLogic, uint8 winsA, uint8 winsB, uint8 currentRound, uint8 drawCounter, uint8 phase, uint8 status, uint256 commitDeadline, uint256 revealDeadline))",
    "function matchCounter() view returns (uint256)"
  ];

  const escrow = new ethers.Contract(escrowAddress, escrowAbi, wallet);

  if (!matchIdArg) {
    const counter = await escrow.matchCounter();
    matchId = Number(counter);
    console.log(`No match ID provided, using latest: ${matchId}`);
  }

  console.log(`Fetching match ${matchId} state...`);
  const match = await escrow.getMatch(matchId);
  const round = Number(match.currentRound);
  const phase = Number(match.phase); // 0=Commit, 1=Reveal

  if (phase !== 1) {
    console.log(`Match is not in REVEAL phase yet (Current phase: ${phase === 0 ? 'COMMIT' : 'OTHER'}).`);
    console.log(`Wait for your opponent to commit before running this script.`);
    return;
  }

  console.log(`Looking up saved move/salt for Round ${round}...`);
  const saltPath = path.join(process.cwd(), 'salts.json');
  if (!fs.existsSync(saltPath)) {
    console.error('Error: salts.json not found. Did you run commit-move.js first?');
    return;
  }

  const salts = JSON.parse(fs.readFileSync(saltPath, 'utf8'));
  const dbMatchId = `${escrowAddress}-${matchId}`;
  const entry = salts[`${dbMatchId}-${round}`];

  if (!entry) {
    console.error(`Error: No saved move found for Match ${matchId} Round ${round} in salts.json`);
    return;
  }

  console.log(`Found! Move: ${entry.move}, Salt: ${entry.salt}`);
  console.log(`Submitting reveal to contract...`);

  try {
    const tx = await escrow.revealMove(matchId, entry.move, entry.salt);
    console.log(`Transaction sent! Hash: ${tx.hash}`);
    await tx.wait();
    console.log('✅ Move revealed successfully!');
    console.log('The round will be resolved once your opponent also reveals.');
  } catch (err) {
    console.error('Failed to reveal move:', err.reason || err.message);
  }
}

main().catch(console.error);
