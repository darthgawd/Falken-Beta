import { execSync } from 'child_process';
import { ensureAnvil } from './setup-network';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';

dotenv.config();

async function runLocalDev() {
  console.log(chalk.blue.bold('\n🏗️  FALKEN LOCAL ORCHESTRATOR\n'));

  // 1. Ensure Anvil is alive
  await ensureAnvil();

  // 2. Deploy Contracts to Local Anvil
  console.log(chalk.yellow('📦 Deploying V4 Contracts to local chain...'));
  // Use Anvil Default Private Key #0
  const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  
  const deployOutput = execSync(
    `cd contracts && forge script script/DeployV4.s.sol:DeployV4 --rpc-url http://127.0.0.1:8545 --broadcast --private-key ${ANVIL_KEY}`,
    { stdio: 'pipe' }
  ).toString();

  const registryMatch = deployOutput.match(/LogicRegistry V4 deployed at: (0x[a-fA-F0-9]{40})/i);
  const pokerMatch = deployOutput.match(/PokerEngine V4 deployed at: (0x[a-fA-F0-9]{40})/i);

  if (!registryMatch || !pokerMatch) throw new Error("Local deploy failed");

  const registryAddr = registryMatch[1];
  const pokerAddr = pokerMatch[1];

  console.log(chalk.green(`✅ Local Deployment Success!`));
  console.log(`   - Registry: ${registryAddr}`);
  console.log(`   - Engine:   ${pokerAddr}\n`);

  // 3. Register Game Logic Locally
  console.log(chalk.yellow('🃏 Registering Poker Logic...'));
  execSync(`npx tsx scripts/deploy-game.ts games/pokerv4.js POKER_V4_LOCAL`, {
    env: { 
      ...process.env, 
      RPC_URL: "http://127.0.0.1:8545",
      LOGIC_REGISTRY_ADDRESS: registryAddr,
      PRIVATE_KEY: ANVIL_KEY 
    }
  });

  // 4. Wipe DB slate
  console.log(chalk.yellow('🧹 Wiping Database Match History...'));
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  await supabase.from('matches').delete().neq('match_id', '0');
  await supabase.from('rounds').delete().neq('match_id', '0');
  await supabase.from('sync_state').upsert({ id: 'indexer_v4', last_processed_block: 0 });

  // 5. Update local environment for services
  // We write to a temporary file or just pass them to the spawns
  console.log(chalk.blue.bold('\n🚀 SERVICES READY. YOU CAN NOW START:'));
  console.log(chalk.white(`   1. Indexer:  RPC_URL=http://localhost:8545 POKER_ENGINE_ADDRESS=${pokerAddr} pnpm -F @falken/indexer dev`));
  console.log(chalk.white(`   2. VM:       RPC_URL=http://localhost:8545 pnpm -F @falken/vm dev`));
  console.log(chalk.white(`   3. Bots:     RPC_URL=http://localhost:8545 pnpm -F llm-house-bot dev\n`));
}

runLocalDev().catch(err => {
  console.error(chalk.red('\n❌ Orchestrator Failed:'), err.message);
  process.exit(1);
});
