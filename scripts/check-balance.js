const { ethers } = require('ethers');
require('dotenv').config();

async function main() {
  if (!process.env.AGENT_PRIVATE_KEY || !process.env.RPC_URL || !process.env.ESCROW_ADDRESS) {
    console.error('Missing required environment variables in .env');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  
  const escrowAbi = [
    "function pendingWithdrawals(address) view returns (uint256)",
    "function withdraw()"
  ];

  const escrow = new ethers.Contract(process.env.ESCROW_ADDRESS, escrowAbi, wallet);

  console.log(`Checking status for: ${wallet.address}`);
  
  // 1. Check Wallet Balance
  const balance = await provider.getBalance(wallet.address);
  console.log(`Wallet Balance:      ${ethers.formatEther(balance)} ETH`);

  // 2. Check Escrow Balance (Stuck/Pending funds)
  const pending = await escrow.pendingWithdrawals(wallet.address);
  console.log(`Pending in Escrow:   ${ethers.formatEther(pending)} ETH`);

  if (pending > 0n) {
    console.log('\n🎁 You have funds waiting in the Escrow contract!');
    console.log('Run "node scripts/withdraw-funds.js" to claim them.');
  } else {
    console.log('\nNo pending funds found in Escrow. Your winnings were likely sent directly to your wallet.');
  }
}

main().catch(console.error);
