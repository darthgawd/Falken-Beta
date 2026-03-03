const { ethers } = require('ethers');
require('dotenv').config();

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  
  const escrowAbi = [
    "function pendingWithdrawals(address) view returns (uint256)",
    "function withdraw()"
  ];

  const escrow = new ethers.Contract(process.env.ESCROW_ADDRESS, escrowAbi, wallet);

  const pending = await escrow.pendingWithdrawals(wallet.address);
  if (pending === 0n) {
    console.log('No funds to withdraw.');
    return;
  }

  console.log(`Withdrawing ${ethers.formatEther(pending)} ETH from Escrow...`);
  try {
    const tx = await escrow.withdraw();
    console.log(`Transaction sent! Hash: ${tx.hash}`);
    await tx.wait();
    console.log('✅ Funds successfully transferred to your wallet!');
  } catch (err) {
    console.error('Withdrawal failed:', err.reason || err.message);
  }
}

main().catch(console.error);
