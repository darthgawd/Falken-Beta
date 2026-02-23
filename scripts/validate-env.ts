import dotenv from 'dotenv';
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';

dotenv.config();

const REQUIRED_KEYS = [
  'RPC_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
  'ESCROW_ADDRESS',
  'RPS_LOGIC_ADDRESS',
  'TREASURY_ADDRESS',
  'PRIVATE_KEY',
  'HOUSE_BOT_PRIVATE_KEY'
];

async function validate() {
  console.log('🔍 Running BotByte Pre-Flight Check...');
  
  const missing = REQUIRED_KEYS.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error('❌ Missing Environment Variables:', missing.join(', '));
    process.exit(1);
  }

  try {
    const client = createPublicClient({
      chain: baseSepolia,
      transport: http(process.env.RPC_URL),
    });
    const block = await client.getBlockNumber();
    console.log(`✅ RPC Connected. Current Block: ${block}`);
  } catch (e) {
    console.error('❌ RPC Connection Failed. Check your RPC_URL.');
    process.exit(1);
  }

  console.log('✅ Pre-Flight Check Passed. Environment is healthy.');
}

validate();
