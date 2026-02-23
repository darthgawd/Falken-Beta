const { ethers } = require('ethers');
require('dotenv').config();

async function main() {
  // Get matchId from command line argument
  const matchIdArg = process.argv[2];
  
  if (!process.env.AGENT_PRIVATE_KEY || !process.env.RPC_URL || !process.env.ESCROW_ADDRESS) {
    console.error('Missing required environment variables in .env');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  
  const escrowAbi = [
    "function joinMatch(uint256 _matchId) payable",
    "function getMatch(uint256 _matchId) view returns (tuple(address playerA, address playerB, uint256 stake, address gameLogic, uint8 winsA, uint8 winsB, uint8 currentRound, uint8 phase, uint8 status, uint256 commitDeadline, uint256 revealDeadline))",
    "function matchCounter() view returns (uint256)"
  ];

  const escrow = new ethers.Contract(process.env.ESCROW_ADDRESS, escrowAbi, wallet);

  let matchId;
  if (matchIdArg) {
    matchId = parseInt(matchIdArg);
  } else {
    const counter = await escrow.matchCounter();
    matchId = Number(counter);
    console.log(`No match ID provided, searching for latest joinable match (starting from ${matchId})...`);
    
    // Scan backwards for the first OPEN match
    let found = false;
    for (let i = matchId; i >= 1; i--) {
      const m = await escrow.getMatch(i);
      if (Number(m.status) === 0) { // 0 = OPEN
        if (m.playerA.toLowerCase() === wallet.address.toLowerCase()) {
          console.log(`Match ${i} is yours (you are Player A). Skipping...`);
          continue;
        }
        matchId = i;
        found = true;
        break;
      }
    }
    
    if (!found) {
      console.error('❌ No joinable OPEN matches found.');
      return;
    }
  }

  console.log(`Checking match ${matchId}...`);
  const match = await escrow.getMatch(matchId);
  const stake = match.stake;

  if (Number(match.status) !== 0) {
    console.error(`❌ Match ${matchId} is not OPEN (Status: ${['OPEN', 'ACTIVE', 'SETTLED', 'VOIDED'][match.status]}).`);
    return;
  }

  console.log(`Joining match ${matchId} with stake: ${ethers.formatEther(stake)} ETH...`);
  console.log(`Account: ${wallet.address}`);

  try {
    const tx = await escrow.joinMatch(matchId, { value: stake });
    console.log(`Transaction sent! Hash: ${tx.hash}`);
    console.log('Waiting for confirmation...');
    await tx.wait();
    console.log('✅ Match joined successfully!');
  } catch (err) {
    console.error('Failed to join match:', err.reason || err.message);
  }
}

main().catch(console.error);
