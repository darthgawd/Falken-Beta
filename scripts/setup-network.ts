import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

/**
 * Falken Network Setup Script
 * 1-Click Environment Generator for new networks (Sepolia -> Mainnet).
 */
async function setupNetwork() {
  console.log(chalk.blue.bold('
🌐 Initializing Falken Network Environment...
'));

  const envPath = path.resolve(process.cwd(), '.env');
  const dashboardEnvPath = path.resolve(process.cwd(), 'apps/dashboard/.env');
  
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
    console.log(chalk.gray('Existing .env detected. Patching missing wallets...'));
  } else {
    console.log(chalk.yellow('No .env found. Generating from scratch...'));
    if (fs.existsSync('.env.example')) {
      envContent = fs.readFileSync('.env.example', 'utf8');
    }
  }

  const wallets = [
    { key: 'PRIVATE_KEY', name: 'Admin/Deployer' },
    { key: 'HOUSE_BOT_PRIVATE_KEY', name: 'House Bot (Joshua)' },
    { key: 'AGENT_PRIVATE_KEY', name: 'Reference Agent' }
  ];

  const summary: any[] = [];

  for (const w of wallets) {
    // Check if key already has a real value (not 0x_ or empty)
    const regex = new RegExp(`^${w.key}=(0x[a-fA-F0-9]{64})`, 'm');
    const match = envContent.match(regex);

    let privateKey = '';
    if (match) {
      privateKey = match[1];
      console.log(chalk.gray(`  - ${w.name}: Using existing key`));
    } else {
      const newWallet = ethers.Wallet.createRandom();
      privateKey = newWallet.privateKey;
      console.log(chalk.green(`  - ${w.name}: Generated fresh wallet`));
      
      // Update or Append
      const replaceRegex = new RegExp(`^${w.key}=.*`, 'm');
      if (replaceRegex.test(envContent)) {
        envContent = envContent.replace(replaceRegex, `${w.key}=${privateKey}`);
      } else {
        envContent += `
${w.key}=${privateKey}`;
      }
    }

    const wallet = new ethers.Wallet(privateKey);
    summary.push({ name: w.name, address: wallet.address });
  }

  // derive DEVELOPER_ADDRESS from PRIVATE_KEY if not set
  if (!envContent.match(/^DEVELOPER_ADDRESS=0x[a-fA-F0-9]{40}/m)) {
    const adminWallet = new ethers.Wallet(summary[0].address); // Summary[0] is ADMIN
    const devLine = `DEVELOPER_ADDRESS=${summary[0].address}`;
    if (envContent.includes('DEVELOPER_ADDRESS=')) {
      envContent = envContent.replace(/^DEVELOPER_ADDRESS=.*/m, devLine);
    } else {
      envContent += `
${devLine}`;
    }
  }

  // Save Root .env
  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log(chalk.green('
✅ Root .env updated.'));

  // Sync to Dashboard
  console.log(chalk.yellow('Syncing to Dashboard...'));
  
  // We only sync specific PUBLIC variables to the dashboard
  const publicKeys = [
    'RPC_URL',
    'ESCROW_ADDRESS',
    'LOGIC_REGISTRY_ADDRESS',
    'PRICE_PROVIDER_ADDRESS',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY'
  ];

  let dashContent = '';
  if (fs.existsSync(dashboardEnvPath)) {
    dashContent = fs.readFileSync(dashboardEnvPath, 'utf8');
  }

  for (const key of publicKeys) {
    const rootMatch = envContent.match(new RegExp(`^${key}=(.*)`, 'm'));
    if (rootMatch) {
      const val = rootMatch[1].trim();
      const nextKey = `NEXT_PUBLIC_${key}`;
      const dashRegex = new RegExp(`^${nextKey}=.*`, 'm');
      
      if (dashRegex.test(dashContent)) {
        dashContent = dashContent.replace(dashRegex, `${nextKey}=${val}`);
      } else {
        dashContent += `
${nextKey}=${val}`;
      }
    }
  }

  fs.writeFileSync(dashboardEnvPath, dashContent, 'utf8');
  console.log(chalk.green('✅ apps/dashboard/.env synchronized.'));

  // FINAL SUMMARY
  console.log(chalk.blue.bold('
📋 NETWORK WALLET SUMMARY (FUND THESE ON THE NEW NETWORK)'));
  console.table(summary);
  
  console.log(chalk.yellow('
ACTION REQUIRED:'));
  console.log(chalk.white(`1. Update ${chalk.bold('RPC_URL')} in .env for your new network.`));
  console.log(chalk.white(`2. Fund the addresses above with native gas tokens.`));
  console.log(chalk.white(`3. Run ${chalk.bold('pnpm contracts:deploy')} to launch new contracts.`));
  console.log(chalk.white(`4. Run ${chalk.bold('pnpm deploy:logic')} for each game logic file.
`));
}

setupNetwork().catch(console.error);
