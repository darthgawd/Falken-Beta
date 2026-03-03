import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const PRICE_PROVIDER_ABI = [
  "function setManualPrice(uint256 _price) external",
  "function manualPrice() view returns (uint256)",
  "function owner() view returns (address)"
];

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.HOUSE_BOT_PK!, provider);
  
  const priceProvider = new ethers.Contract(
    process.env.PRICE_PROVIDER_ADDRESS!,
    PRICE_PROVIDER_ABI,
    wallet
  );
  
  console.log('Setting manual price on PriceProvider...');
  console.log('Contract:', await priceProvider.getAddress());
  console.log('Owner:', await priceProvider.owner());
  console.log('Current manual price:', (await priceProvider.manualPrice()).toString());
  
  // Set ETH price to $3000 with 8 decimals (Chainlink format)
  // 3000 * 1e8 = 300000000000
  const ethPrice = 3000n * 10n**8n;
  
  console.log('Setting ETH price to $3000...');
  const tx = await priceProvider.setManualPrice(ethPrice);
  await tx.wait();
  
  console.log('✅ Manual price set successfully!');
  console.log('New manual price:', (await priceProvider.manualPrice()).toString());
}

main().catch(console.error);
