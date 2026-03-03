import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import dotenv from 'dotenv';

// Load existing env
dotenv.config();

/**
 * MASTER RECREATE SCRIPT
 * 1-Click to deploy everything to a new network.
 */
async function recreateProtocol() {
  console.log(chalk.blue.bold('
🔥 STARTING FULL PROTOCOL RECONSTRUCTION 🔥
'));

  const chainId = process.env.CHAIN_ID || '84532'; // Default Base Sepolia
  const broadcastPath = path.resolve(process.cwd(), `contracts/broadcast/Deploy.s.sol/${chainId}/run-latest.json`);

  try {
    // --- PHASE 1: WALLET SETUP ---
    console.log(chalk.yellow('[1/5] Ensuring wallets are initialized...'));
    execSync('npx tsx scripts/setup-network.ts', { stdio: 'inherit' });
    // Reload env after setup-network updates it
    const envContent = fs.readFileSync('.env', 'utf8');

    // --- PHASE 2: CONTRACT DEPLOYMENT ---
    console.log(chalk.yellow('
[2/5] Deploying Core Contracts via Forge...'));
    execSync('pnpm contracts:deploy', { stdio: 'inherit' });

    // --- PHASE 3: CAPTURE NEW ADDRESSES ---
    console.log(chalk.yellow('
[3/5] Extracting new contract addresses...'));
    if (!fs.existsSync(broadcastPath)) {
      throw new Error(`Foundry broadcast log not found at ${broadcastPath}`);
    }
    
    const broadcast = JSON.parse(fs.readFileSync(broadcastPath, 'utf8'));
    const transactions = broadcast.transactions;
    
    const findAddress = (contractName: string) => {
      const tx = transactions.find((t: any) => t.contractName === contractName);
      return tx ? tx.contractAddress : null;
    };

    const priceProvider = findAddress('PriceProvider');
    const logicRegistry = findAddress('LogicRegistry');
    const escrow = findAddress('FiseEscrow');
    const rpsLogic = findAddress('RPS');

    if (!priceProvider || !logicRegistry || !escrow) {
      throw new Error('Failed to find all contract addresses in broadcast logs.');
    }

    console.log(chalk.green(`  - PriceProvider: ${priceProvider}`));
    console.log(chalk.green(`  - LogicRegistry: ${logicRegistry}`));
    console.log(chalk.green(`  - FiseEscrow:    ${escrow}`));

    // --- PHASE 4: UPDATE ENV FILES ---
    console.log(chalk.yellow('
[4/5] Updating environment files with new addresses...'));
    
    let newEnv = fs.readFileSync('.env', 'utf8');
    
    const updates = [
      { key: 'PRICE_PROVIDER_ADDRESS', val: priceProvider },
      { key: 'LOGIC_REGISTRY_ADDRESS', val: logicRegistry },
      { key: 'ESCROW_ADDRESS', val: escrow },
      { key: 'FISE_ESCROW_ADDRESS', val: escrow },
      { key: 'RPS_LOGIC_ADDRESS', val: rpsLogic || '' }
    ];

    for (const u of updates) {
      const regex = new RegExp(`^${u.key}=.*`, 'm');
      if (regex.test(newEnv)) {
        newEnv = newEnv.replace(regex, `${u.key}=${u.val}`);
      } else {
        newEnv += `
${u.key}=${u.val}`;
      }
    }

    fs.writeFileSync('.env', newEnv, 'utf8');
    console.log(chalk.gray('  - Root .env updated.'));
    
    // Run setup-network again to sync these to dashboard
    execSync('npx tsx scripts/setup-network.ts', { stdio: 'ignore' });
    console.log(chalk.gray('  - apps/dashboard/.env synchronized.'));

    // --- PHASE 5: REDEPLOY GAME LOGIC ---
    console.log(chalk.yellow('
[5/5] Redeploying Core Game Logic (IPFS -> On-Chain -> Bots)...'));
    
    const games = [
      { file: './rps.js', name: 'RockPaperScissorsJS' },
      { file: './poker.js', name: 'ShowdownBlitzPoker' },
      { file: './liarsdice.js', name: 'LiarsDiceJS' },
      { file: './tetris.js', name: 'TetrisDuel' }
    ];

    for (const game of games) {
      if (fs.existsSync(game.file)) {
        console.log(chalk.cyan(`  Deploying ${game.name}...`));
        try {
          // Use our 1-click deploy-game script for each
          execSync(`npx tsx scripts/deploy-game.ts ${game.file} ${game.name}`, { stdio: 'inherit' });
        } catch (err) {
          console.error(chalk.red(`  ⚠️ Failed to deploy ${game.name}, skipping...`));
        }
      }
    }

    console.log(chalk.blue.bold('
✨ PROTOCOL RECONSTRUCTION SUCCESSFUL ✨'));
    console.log(chalk.white('Everything is live on the new network.'));
    console.log(chalk.gray('1. Fund your wallets.'));
    console.log(chalk.gray('2. Restart your bots: pnpm housebot:start && pnpm agent:start
'));

  } catch (err: any) {
    console.error(chalk.red(`
❌ RECONSTRUCTION FAILED: ${err.message}`));
    process.exit(1);
  }
}

recreateProtocol().catch(console.error);
