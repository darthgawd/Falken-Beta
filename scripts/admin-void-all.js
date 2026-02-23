const { ethers } = require('ethers');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function main() {
  if (!process.env.PRIVATE_KEY || !process.env.RPC_URL || !process.env.ESCROW_ADDRESS || !process.env.SUPABASE_URL) {
    console.error('Missing required environment variables in .env');
    process.exit(1);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  
  const escrowAbi = [
    "function adminVoidMatch(uint256 _matchId)",
    "function owner() view returns (address)"
  ];

  const escrow = new ethers.Contract(process.env.ESCROW_ADDRESS, escrowAbi, wallet);

  console.log('--- MASS VOID SCRIPT ---');
  
  // 1. Fetch all OPEN and ACTIVE matches from DB
  const { data: matches, error } = await supabase
    .from('matches')
    .select('match_id, status')
    .or('status.eq.OPEN,status.eq.ACTIVE');

  if (error) {
    console.error('Error fetching matches:', error.message);
    return;
  }

  if (!matches || matches.length === 0) {
    console.log('No open or active matches found.');
    return;
  }

  console.log(`Found ${matches.length} matches to void.`);

  for (const m of matches) {
    // Extract numeric ID from string ID (addr-id)
    const onChainId = m.match_id.split('-').pop();
    console.log(`Voiding match ${onChainId} (Current DB Status: ${m.status})...`);
    
    try {
      const tx = await escrow.adminVoidMatch(onChainId);
      console.log(`Transaction sent: ${tx.hash}`);
      await tx.wait();
      console.log(`✅ Match ${onChainId} voided.`);
    } catch (err) {
      console.error(`Failed to void ${onChainId}:`, err.reason || err.message);
    }
  }

  console.log('\n--- FINISHED ---');
}

main().catch(console.error);
