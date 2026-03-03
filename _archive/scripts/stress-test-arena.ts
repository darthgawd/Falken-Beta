import { ethers } from 'ethers';
import dotenv from 'dotenv';
import chalk from 'chalk';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const RPC_URL = process.env.RPC_URL;
const ESCROW_ADDRESS = process.env.ESCROW_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY; 
const RPS_LOGIC = (process.env.RPS_LOGIC_ADDRESS || '').toLowerCase();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const ESCROW_ABI = [
  "function createMatch(uint256 stake, address gameLogic) external payable",
  "function joinMatch(uint256 matchId) external payable",
  "function commitMove(uint256 matchId, bytes32 commitHash) external",
  "function revealMove(uint256 matchId, uint8 move, bytes32 salt) external",
  "function matchCounter() view returns (uint256)"
];

async function stressTest() {
  console.log(chalk.red.bold('\n🔥 INITIATING ARENA STRESS TEST (CHAOS MONKEY) 🔥\n'));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const masterWallet = new ethers.Wallet(PRIVATE_KEY!, provider);
  const escrow = new ethers.Contract(ESCROW_ADDRESS!, ESCROW_ABI, masterWallet);

  // 1. Generate 10 Temp Wallets
  console.log(chalk.yellow(`[1/5] Generating 10 worker wallets...`));
  const workers = Array.from({ length: 10 }).map(() => ethers.Wallet.createRandom().connect(provider));
  
  // 2. Fund Workers (0.005 ETH each)
  console.log(chalk.yellow(`[2/5] Funding workers with gas...`));
  for (const worker of workers) {
    try {
      const tx = await masterWallet.sendTransaction({
        to: worker.address,
        value: ethers.parseEther('0.005')
      });
      await tx.wait();
      console.log(chalk.gray(`  -> Funded ${worker.address.slice(0, 10)}...`));
    } catch (e: any) {
      console.error(chalk.red(`  ❌ Funding failed for ${worker.address}: ${e.message}`));
    }
  }

  // 3. Create 10 Matches
  console.log(chalk.yellow('\n[3/5] Spawning 5 concurrent matches...'));
  const stake = ethers.parseEther('0.0005');

  const createPromises = workers.slice(0, 5).map(async (worker, i) => {
    const workerEscrow = escrow.connect(worker) as any;
    try {
      const tx = await workerEscrow.createMatch(stake, RPS_LOGIC, { value: stake });
      const receipt = await tx.wait();
      console.log(chalk.green(`  ✅ Match ${i+1} Created by Worker ${i}`));
    } catch (e: any) {
      console.error(chalk.red(`  ❌ Match Creation Failed: ${e.message}`));
    }
  });

  await Promise.all(createPromises);

  // 4. Wait for Indexer
  console.log(chalk.yellow('\n[4/5] Waiting for Indexer & DB Synchronization (15s)...'));
  await new Promise(r => setTimeout(r, 15000));

  // 5. Mass Join & Play
  console.log(chalk.yellow('\n[5/5] Attempting high-velocity JOIN and MOVE sequence...'));
  
  const { data: openMatches } = await supabase
    .from('matches')
    .select('match_id')
    .eq('status', 'OPEN')
    .order('created_at', { ascending: false })
    .limit(5);

  if (!openMatches || openMatches.length === 0) {
    console.error(chalk.red('Abort: No matches found in DB. Indexer might be lagging.'));
    process.exit(1);
  }

  console.log(chalk.cyan(`Found ${openMatches.length} matches in DB. Starting assault...`));

  const joinPromises = openMatches.map(async (m, i) => {
    const matchId = m.match_id.split('-').pop();
    const worker = workers[i + 5]; 
    const workerEscrow = escrow.connect(worker) as any;

    try {
      console.log(chalk.gray(`  Worker ${i+5} joining ${matchId}...`));
      const tx = await workerEscrow.joinMatch(matchId, { value: stake });
      await tx.wait();
      
      const move = 1; // Rock
      const salt = ethers.randomBytes(32);
      const hash = ethers.solidityPackedKeccak256(
        ['string', 'address', 'uint256', 'uint256', 'address', 'uint256', 'bytes32'],
        ["FALKEN_V1", ESCROW_ADDRESS, matchId, 1, worker.address, move, salt]
      );

      console.log(chalk.gray(`  Worker ${i+5} committing move to ${matchId}...`));
      await workerEscrow.commitMove(matchId, hash);
      console.log(chalk.green(`  ⚡ Blitz Move Success on Match ${matchId}`));
    } catch (e: any) {
      console.error(chalk.red(`  🔥 SYSTEM COLLAPSE ON MATCH ${matchId}: ${e.message}`));
    }
  });

  await Promise.all(joinPromises);

  console.log(chalk.blue.bold('\n🚀 STRESS TEST COMPLETE. CHECK DASHBOARD FOR ERRORS.\n'));
}

stressTest().catch(console.error);
