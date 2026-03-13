import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import dotenv from 'dotenv';

dotenv.config();

/**
 * V4 ONE-CLICK DEPLOYER
 * --------------------
 * 1. Runs Forge Script to deploy V4 LogicRegistry, PokerEngine, and PredictionPool.
 * 2. Parses the output for new addresses.
 * 3. Updates root .env and apps/dashboard/.env.
 */
async function deployV4() {
  console.log(chalk.blue.bold('\n🚀 Starting Falken V4 Deployment (Wager Phase + Spectator Pools)...\n'));

  try {
    // 1. Run the Forge script
    console.log(chalk.yellow('Broadcasting to Base Sepolia...'));
    const output = execSync(
      'cd contracts && forge script script/DeployV4.s.sol:DeployV4 --rpc-url $RPC_URL --broadcast',
      { stdio: 'pipe', env: process.env }
    ).toString();

    console.log(chalk.gray(output));

    // 2. Extract addresses using Regex
    const registryMatch = output.match(/LogicRegistry V4 deployed at: (0x[a-fA-F0-9]{40})/i);
    const pokerMatch = output.match(/PokerEngine V4 deployed at: (0x[a-fA-F0-9]{40})/i);
    const poolMatch = output.match(/PredictionPool V4 deployed at: (0x[a-fA-F0-9]{40})/i);

    if (!registryMatch || !pokerMatch || !poolMatch) {
      throw new Error('Could not parse all V4 contract addresses from forge output.');
    }

    const logicRegistryAddress = registryMatch[1];
    const pokerEngineAddress = pokerMatch[1];
    const predictionPoolAddress = poolMatch[1];

    console.log(chalk.green.bold('\n✅ Deployment Successful!'));
    console.log(chalk.white(`   - LogicRegistry:   ${logicRegistryAddress}`));
    console.log(chalk.white(`   - PokerEngine:     ${pokerEngineAddress}`));
    console.log(chalk.white(`   - PredictionPool:  ${predictionPoolAddress}\n`));

    // 3. Update .env files
    updateEnv('LOGIC_REGISTRY_ADDRESS', logicRegistryAddress);
    updateEnv('POKER_ENGINE_ADDRESS', pokerEngineAddress);
    updateEnv('PREDICTION_POOL_ADDRESS', predictionPoolAddress);
    
    // Legacy support: set ESCROW_ADDRESS to the new PokerEngine
    updateEnv('ESCROW_ADDRESS', pokerEngineAddress);

    console.log(chalk.blue('\n🌍 Environment files synchronized. V4 is now active.'));

  } catch (err: any) {
    console.error(chalk.red('\n❌ Deployment Failed:'), err.message);
    process.exit(1);
  }
}

function updateEnv(key: string, value: string) {
  const envPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'apps/dashboard/.env')
  ];

  envPaths.forEach(envPath => {
    if (!fs.existsSync(envPath)) return;

    let content = fs.readFileSync(envPath, 'utf8');
    
    // Update raw key (e.g. LOGIC_REGISTRY_ADDRESS)
    const rawRegex = new RegExp(`^${key}=.*`, 'm');
    if (rawRegex.test(content)) {
      content = content.replace(rawRegex, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }

    // Update NEXT_PUBLIC_ key for dashboard
    const nextKey = `NEXT_PUBLIC_${key}`;
    const nextRegex = new RegExp(`^${nextKey}=.*`, 'm');
    if (nextRegex.test(content)) {
      content = content.replace(nextRegex, `${nextKey}=${value}`);
    } else {
      content += `\n${nextKey}=${value}`;
    }

    fs.writeFileSync(envPath, content, 'utf8');
    console.log(chalk.gray(`   - Updated ${key} in ${path.relative(process.cwd(), envPath)}`));
  });
}

deployV4().catch(console.error);
