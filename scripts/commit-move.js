const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function main() {
  // Get matchId from command line argument, or default to 5
  const matchIdArg = process.argv[2];
  let matchId = matchIdArg ? parseInt(matchIdArg) : 5; 
  
  const move = Math.floor(Math.random() * 3); // 0=Rock, 1=Paper, 2=Scissors - NOW RANDOM!
  
  if (!process.env.AGENT_PRIVATE_KEY || !process.env.RPC_URL || !process.env.ESCROW_ADDRESS) {
    console.error('Missing required environment variables in .env');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  const escrowAddress = process.env.ESCROW_ADDRESS.toLowerCase();
  
  const escrowAbi = [
    "function commitMove(uint256 _matchId, bytes32 _commitHash)",
    "function getMatch(uint256 _matchId) view returns (tuple(address playerA, address playerB, uint256 stake, address gameLogic, uint8 winsA, uint8 winsB, uint8 currentRound, uint8 phase, uint8 status, uint256 commitDeadline, uint256 revealDeadline))",
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

  console.log(`Generating random move for Round ${round}...`);
  const salt = ethers.hexlify(ethers.randomBytes(32));
  
  const hash = ethers.solidityPackedKeccak256(
    ['uint256', 'uint8', 'address', 'uint8', 'bytes32'],
    [matchId, round, wallet.address, move, salt]
  );

  console.log(`Move: ${['Rock', 'Paper', 'Scissors'][move]}`);
  console.log(`Salt: ${salt}`);
  console.log(`Hash: ${hash}`);

  // SAVE SALT (Crucial for Reveal Phase!)
  const saltPath = path.join(process.cwd(), 'salts.json');
  let salts = {};
  if (fs.existsSync(saltPath)) {
    salts = JSON.parse(fs.readFileSync(saltPath, 'utf8'));
  }
  const dbMatchId = `${escrowAddress}-${matchId}`;
  salts[`${dbMatchId}-${round}`] = { move, salt };
  fs.writeFileSync(saltPath, JSON.stringify(salts, null, 2));
  console.log(`✅ Salt saved to salts.json`);

  console.log(`Submitting commit to contract...`);
  try {
    const tx = await escrow.commitMove(matchId, hash);
    console.log(`Transaction sent! Hash: ${tx.hash}`);
    await tx.wait();
    console.log('✅ Move committed successfully!');
    console.log('Next Step: Wait for your opponent to commit, then run the reveal script.');
  } catch (err) {
    console.error('Failed to commit move:', err.reason || err.message);
  }
}

main().catch(console.error);
