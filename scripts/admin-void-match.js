const { ethers } = require('ethers');
require('dotenv').config();

async function main() {
  const matchIds = process.argv.slice(2);
  
  if (matchIds.length === 0) {
    console.error('Usage: node scripts/admin-void-match.js <id1> [id2] ...');
    console.error('Example: node scripts/admin-void-match.js 1 3 4');
    process.exit(1);
  }

  if (!process.env.PRIVATE_KEY || !process.env.RPC_URL || !process.env.ESCROW_ADDRESS) {
    console.error('Missing required environment variables in .env');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider); // Using the main PRIVATE_KEY (owner)
  
  const escrowAbi = [
    "function adminVoidMatch(uint256 _matchId)",
    "function owner() view returns (address)"
  ];

  const escrow = new ethers.Contract(process.env.ESCROW_ADDRESS, escrowAbi, wallet);

  // Security check
  const contractOwner = await escrow.owner();
  if (contractOwner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error('Error: Your PRIVATE_KEY is not the owner of this contract.');
    console.error(`Owner: ${contractOwner}`);
    console.error(`You:  ${wallet.address}`);
    process.exit(1);
  }

  for (const id of matchIds) {
    console.log(`Voiding match ${id}...`);
    try {
      const tx = await escrow.adminVoidMatch(id);
      console.log(`Transaction sent! Hash: ${tx.hash}`);
      await tx.wait();
      console.log(`✅ Match ${id} voided and stakes refunded.`);
    } catch (err) {
      console.error(`Failed to void match ${id}:`, err.reason || err.message);
    }
  }
}

main().catch(console.error);
