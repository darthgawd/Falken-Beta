const { ethers } = require('ethers');
require('dotenv').config();

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  
  const escrowAbi = [
    "function getMatch(uint256 _matchId) view returns (tuple(address playerA, address playerB, uint256 stake, address gameLogic, uint8 winsA, uint8 winsB, uint8 currentRound, uint8 phase, uint8 status, uint256 commitDeadline, uint256 revealDeadline))",
    "function matchCounter() view returns (uint256)"
  ];

  const escrow = new ethers.Contract(process.env.ESCROW_ADDRESS, escrowAbi, provider);

  const matchIdArg = process.argv[2];
  let matchId;
  if (matchIdArg) {
    matchId = parseInt(matchIdArg);
  } else {
    const counter = await escrow.matchCounter();
    matchId = Number(counter);
  }

  console.log('--- On-Chain State ---');
  console.log(`Contract: ${process.env.ESCROW_ADDRESS}`);
  
  try {
    const m = await escrow.getMatch(matchId);
    console.log(`Match ID: ${matchId}`);
    console.log(`Player A: ${m.playerA}`);
    console.log(`Player B: ${m.playerB}`);
    console.log(`Stake:    ${ethers.formatEther(m.stake)} ETH`);
    console.log(`Status:   ${['OPEN', 'ACTIVE', 'SETTLED', 'VOIDED'][Number(m.status)]}`);
    console.log(`Phase:    ${['COMMIT', 'REVEAL'][Number(m.phase)]}`);
    console.log(`Wins A:   ${m.winsA}`);
    console.log(`Wins B:   ${m.winsB}`);
    console.log(`Round:    ${m.currentRound}`);
    console.log(`Commit Deadline: ${new Date(Number(m.commitDeadline) * 1000).toLocaleString()}`);
    console.log(`Reveal Deadline: ${new Date(Number(m.revealDeadline) * 1000).toLocaleString()}`);
    console.log(`Current Time:    ${new Date().toLocaleString()}`);
    
    if (process.env.AGENT_PRIVATE_KEY) {
      const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY);
      console.log(`
--- Local Agent ---`);
      console.log(`Agent Address: ${wallet.address}`);
      const isA = m.playerA.toLowerCase() === wallet.address.toLowerCase();
      const isB = m.playerB.toLowerCase() === wallet.address.toLowerCase();
      console.log(`Is Participant: ${isA || isB ? 'YES' : 'NO'} (${isA ? 'Player A' : isB ? 'Player B' : 'None'})`);
    }
  } catch (err) {
    console.error('Error fetching match:', err.message);
  }
}

main().catch(console.error);
