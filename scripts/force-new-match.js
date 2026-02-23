const { ethers } = require('ethers');
require('dotenv').config();

async function run() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.HOUSE_BOT_PRIVATE_KEY, provider);
  
  const abi = ["function createMatch(uint256 _stake, address _gameLogic) payable"];
  const escrow = new ethers.Contract(process.env.ESCROW_ADDRESS, abi, wallet);
  
  const stake = ethers.parseEther(process.env.HOUSE_BOT_STAKE_ETH || "0.002");
  const logic = process.env.RPS_LOGIC_ADDRESS;

  console.log('🚀 Forcing new match creation...');
  console.log('Wallet:', wallet.address);
  console.log('Stake:', process.env.HOUSE_BOT_STAKE_ETH || "0.002", 'ETH');

  try {
    const tx = await escrow.createMatch(stake, logic, { value: stake });
    console.log('✅ Transaction Sent! Hash:', tx.hash);
    await tx.wait();
    console.log('🎉 Match Created Successfully!');
  } catch (err) {
    console.error('❌ Failed to create match:', err.message);
  }
}

run();
