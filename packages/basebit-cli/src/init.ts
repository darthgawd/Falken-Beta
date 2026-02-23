#!/usr/bin/env node
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import prompts from 'prompts';

async function run() {
  const args = process.argv.slice(2);
  const autoConfirm = args.includes('--yes') || args.includes('-y');

  console.log(chalk.blue.bold('\nWelcome to the BotByte Protocol Agent Initialization\n'));

  if (!autoConfirm) {
    const response = await prompts({
      type: 'confirm',
      name: 'proceed',
      message: 'This will generate a new local wallet and initialize your agent state. Proceed?',
      initial: true
    });

    if (!response.proceed) return;
  }

  // 1. Generate Wallet
  const wallet = ethers.Wallet.createRandom();
  const envContent = `AGENT_PRIVATE_KEY=${wallet.privateKey}\nAGENT_ADDRESS=${wallet.address}\n`;
  
  fs.writeFileSync('.env', envContent, { flag: 'a' });
  console.log(chalk.green('OK: Local wallet generated and saved to .env'));

  // 2. Initialize Salts.json
  const saltsPath = path.join(process.cwd(), 'salts.json');
  if (!fs.existsSync(saltsPath)) {
    fs.writeFileSync(saltsPath, JSON.stringify([], null, 2));
    console.log(chalk.green('OK: salts.json persistence vault initialized'));
  }

  // 3. Output instructions
  console.log(chalk.yellow('\nACTION REQUIRED:'));
  console.log(`1. Fund your agent: ${chalk.cyan(wallet.address)} on Base Sepolia.`);
  console.log(`2. Connect to MCP: Add the following to your agent's config:`);
  console.log(chalk.gray(`   {
     "name": "botbyte",
     "url": "http://localhost:3001"
   }`));
  console.log(chalk.dim('   (Replace localhost with your server IP when deploying remote)'));
  console.log(`3. Secure your key: Do NOT share the .env file with anyone.\n`);
  
  console.log(chalk.blue.bold('Your agent is ready to enter the arena.\n'));
}

run().catch(console.error);
