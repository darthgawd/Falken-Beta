import { execSync } from 'child_process';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import chalk from 'chalk';

// Load environment
dotenv.config();

const LOGIC_REGISTRY_ADDRESS = process.env.LOGIC_REGISTRY_ADDRESS;
const DEVELOPER_ADDRESS = process.env.DEVELOPER_ADDRESS;
const ADMIN_PRIVATE_KEY = process.env.PRIVATE_KEY; // The deployer key
const RPC_URL = process.env.RPC_URL;

const LOGIC_REGISTRY_ABI = [
  "function registerLogic(string calldata ipfsCid, address developer) external returns (bytes32)",
  "event LogicRegistered(bytes32 indexed logicId, string ipfsCid, address indexed developer)"
];

async function deployGame() {
  const args = process.argv.slice(2);
  const logicFile = args[0];
  const gameName = args[1];

  if (!logicFile || !gameName) {
    console.error(chalk.red('Usage: npx tsx scripts/deploy-game.ts <path-to-logic.js> <GameName>'));
    console.error(chalk.gray('Example: npx tsx scripts/deploy-game.ts games/poker.js POKER_BLITZ'));
    process.exit(1);
  }

  if (!LOGIC_REGISTRY_ADDRESS || !DEVELOPER_ADDRESS || !ADMIN_PRIVATE_KEY || !RPC_URL) {
    console.error(chalk.red('Missing required environment variables (.env): LOGIC_REGISTRY_ADDRESS, DEVELOPER_ADDRESS, PRIVATE_KEY, RPC_URL'));
    process.exit(1);
  }

  console.log(chalk.blue.bold(`
🚀 Starting 1-Click Deployment for: ${gameName}
`));

  // --- STEP 1: Pin to IPFS ---
  console.log(chalk.yellow('[1/4] Bundling and pinning to IPFS...'));
  
  // Build CLI first just in case
  execSync('pnpm -F falken-cli build', { stdio: 'ignore' });
  
  // Run deploy command
  const deployCmd = `node packages/falken-cli/dist/index.js deploy ${logicFile} --name ${gameName}`;
  const deployOut = execSync(deployCmd, { encoding: 'utf8' });
  
  // Extract CID from CLI output
  const cidMatch = deployOut.match(/CID:\s+(Qm[a-zA-Z0-9]+)/);
  if (!cidMatch) {
    console.error(chalk.red('Failed to extract CID from falken-cli output:'));
    console.log(deployOut);
    process.exit(1);
  }
  const cid = cidMatch[1];
  console.log(chalk.green(`✅ Pinned to IPFS. CID: ${cid}`));

  // --- STEP 2: Register On-Chain ---
  console.log(chalk.yellow('\n[2/4] Registering Logic on Base Sepolia...'));
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
  const registry = new ethers.Contract(LOGIC_REGISTRY_ADDRESS, LOGIC_REGISTRY_ABI, wallet);

  try {
    const tx = await registry.registerLogic(cid, DEVELOPER_ADDRESS);
    console.log(chalk.gray(`Waiting for transaction: ${tx.hash}`));
    const receipt = await tx.wait();
    console.log(chalk.green(`✅ Registered on-chain in block ${receipt.blockNumber}`));
  } catch (e: any) {
    if (e.message.includes('Logic already registered')) {
      console.log(chalk.yellow('⚠️ Logic already registered. Proceeding to hash calculation.'));
    } else {
      console.error(chalk.red(`Registration failed: ${e.message}`));
      process.exit(1);
    }
  }

  // --- STEP 3: Calculate Logic ID ---
  console.log(chalk.yellow('\n[3/4] Calculating Deterministic Logic ID...'));
  // keccak256 of the CID string
  const cidBytes = ethers.toUtf8Bytes(cid);
  const logicId = ethers.keccak256(cidBytes);
  console.log(chalk.green(`✅ Logic ID generated: ${logicId}`));

  // --- STEP 4: Inject into Bots ---
  console.log(chalk.yellow('\n[4/4] Injecting Logic ID into Bot Architectures...'));

  const filesToUpdate = [
    {
      path: 'packages/house-bot/src/HouseBot.ts',
      // Find the gameLogics array and inject it if not present
      patch: (content: string) => {
        if (content.includes(logicId)) return content;
        return content.replace(
          /this\.gameLogics\s*=\s*\[([\s\S]*?)\]\.filter/,
          (match, inner) => `this.gameLogics = [
      "${logicId}", // Auto-injected: ${gameName}${inner}]\.filter`
        );
      }
    },
    {
      path: 'packages/reference-agent/src/SimpleAgent.ts',
      // Add logicId to the OPEN FISE matches check
      patch: (content: string) => {
        if (content.includes(logicId)) return content;
        return content.replace(
          /(logicId === '0xc60d070e0cede74c425c5c5afe657be8f62a5dfa37fb44e72d0b18522806ffd4')/g,
          `$1 ||
              logicId === '${logicId}'`
        );
      }
    },
    {
      path: 'packages/llm-house-bot/src/index.ts',
      patch: (content: string) => {
        if (content.includes(logicId)) return content;
        return content.replace(
          /(logicId === '0xc60d070e0cede74c425c5c5afe657be8f62a5dfa37fb44e72d0b18522806ffd4')/g,
          `$1 ||
              logicId === '${logicId}'`
        );
      }
    }
  ];

  let injectedCount = 0;
  for (const file of filesToUpdate) {
    const fullPath = path.resolve(process.cwd(), file.path);
    if (fs.existsSync(fullPath)) {
      const oldContent = fs.readFileSync(fullPath, 'utf8');
      const newContent = file.patch(oldContent);
      if (oldContent !== newContent) {
        fs.writeFileSync(fullPath, newContent, 'utf8');
        console.log(chalk.gray(`  -> Injected into ${file.path}`));
        injectedCount++;
      } else {
        console.log(chalk.gray(`  -> Skipped ${file.path} (Already exists or anchor missing)`));
      }
    }
  }
  
  if (injectedCount > 0) {
     console.log(chalk.green(`✅ Successfully injected Logic ID into ${injectedCount} bot files.`));
  } else {
     console.log(chalk.yellow(`⚠️ No files modified. They may already contain the Logic ID.`));
  }

  // --- STEP 5: Update Supabase Alias ---
  console.log(chalk.yellow('\n[5/5] Updating Supabase Logic Alias...'));
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const aliasName = gameName.toUpperCase().replace(/\s+/g, '_');
    
    const { error } = await supabase
      .from('logic_aliases')
      .upsert({ alias_name: aliasName, logic_id: logicId, is_active: true }, { onConflict: 'alias_name' });

    if (error) throw error;
    console.log(chalk.green(`✅ Alias '${aliasName}' updated to ${logicId}`));
  } catch (err: any) {
    console.error(chalk.red(`⚠️ Failed to update Supabase alias: ${err.message}`));
  }

  console.log(chalk.blue.bold('\n🎉 DEPLOYMENT COMPLETE!'));
  console.log(chalk.white(`Logic ID: ${chalk.bold(logicId)}`));
  console.log(chalk.gray(`To activate bots with new logic, restart them: pnpm housebot:start && pnpm agent:start
`));
}

deployGame().catch(console.error);
