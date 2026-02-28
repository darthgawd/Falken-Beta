const { ethers } = require('ethers');
require('dotenv').config();

const addresses = [
  '0xE155B0F15dfB5D65364bca23a08501c7384eb737',
  '0x08d96424f10E7D7c356d7E770b03c88741c33BfF',
  '0xaa382750e4f64e64039f9c5a96836a16c36c908f'
];

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  
  const abi = [
    "function adminVoidMatch(uint256 _matchId)",
    "function matchCounter() view returns (uint256)",
    "function getMatch(uint256 _matchId) view returns (address, address, uint256, address, uint8, uint8, uint8, uint8, uint8, uint8, uint256, uint256)"
  ];

  for (const addr of addresses) {
    console.log(`--- Checking Escrow: ${addr} ---`);
    const escrow = new ethers.Contract(addr, abi, wallet);
    
    try {
      const counter = await escrow.matchCounter();
      console.log(`Total matches: ${counter}`);
      
      for (let i = 1; i <= Number(counter); i++) {
        try {
          const match = await escrow.getMatch(i);
          const status = Number(match[9]);
          if (status === 0 || status === 1) {
            console.log(`Voiding match ${i} (status ${status})...`);
            const tx = await escrow.adminVoidMatch(i);
            await tx.wait();
            console.log(`✅ Match ${i} voided.`);
          }
        } catch (e) {
          // Skip errors
        }
      }
    } catch (err) {
      console.log(`Could not check ${addr}: ${err.message}`);
    }
  }
}

main().catch(console.error);
