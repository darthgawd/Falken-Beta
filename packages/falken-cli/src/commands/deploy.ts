import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import * as esbuild from 'esbuild';
import pinataSDK from '@pinata/sdk';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables for the CLI
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config(); // Fallback to local

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

/**
 * Falken CLI: Submit Logic for Review
 * Bundles code, uploads to IPFS, and queues for review.
 */
export async function deployCommand(file: string, options: any) {
  console.log(chalk.blue.bold('\nInitializing Logic Submission Sequence...\n'));

  // 1. Validate File
  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) {
    console.log(chalk.red(`ERROR: File not found at ${filePath}`));
    return;
  }

  const gameName = options.name || path.basename(filePath, '.ts').replace('.js', '');
  const tempBundlePath = path.join(process.cwd(), `temp_${gameName}.bundle.js`);

  try {
    // 2. The Bundler: Package everything into one file
    console.log(chalk.yellow('Bundling logic and dependencies...'));
    await esbuild.build({
      entryPoints: [filePath],
      bundle: true,
      outfile: tempBundlePath,
      platform: 'neutral',
      target: 'es2020',
      format: 'esm',
      minify: true,
      external: ['isolated-vm'], // We provide this in the sandbox
    });

    const bundledContent = fs.readFileSync(tempBundlePath, 'utf8');
    console.log(chalk.green(`OK: Bundle created (${bundledContent.length} bytes).`));

    // 3. Pinata IPFS Integration
    console.log(chalk.yellow('Uploading to IPFS via Pinata Enclave...'));
    
    let cid: string;
    if (!process.env.PINATA_API_KEY || !process.env.PINATA_SECRET_API_KEY) {
      console.log(chalk.red('ERROR: PINATA_API_KEY or PINATA_SECRET_API_KEY missing from .env'));
      console.log(chalk.gray('For Beta, using simulated CID.'));
      // Fallback for demo/dev without keys
      cid = 'sim_' + Math.random().toString(36).substring(7);
    } else {
      const pinata = new (pinataSDK as any)(process.env.PINATA_API_KEY, process.env.PINATA_SECRET_API_KEY);
      const readableStreamForFile = fs.createReadStream(tempBundlePath);
      const pinOptions = {
        pinataMetadata: { name: `FALKEN_LOGIC_${gameName}` },
        pinataOptions: { cidVersion: 0 as any }
      };
      
      const result = await pinata.pinFileToIPFS(readableStreamForFile, pinOptions);
      cid = result.IpfsHash;
    }

    console.log(chalk.green(`OK: Logic pinned to IPFS. CID: ${cid}`));

    // 4. Submit to Protocol Queue
    console.log(chalk.yellow('\nSubmitting to Protocol Review Queue...'));
    
    const devAddress = process.env.DEVELOPER_ADDRESS;
    if (!devAddress) {
      console.log(chalk.red('ERROR: DEVELOPER_ADDRESS not found in .env'));
      console.log(chalk.yellow('ACTION: Please add your wallet address to receive your 2% game royalties.'));
      return;
    }

    const { error } = await supabase.from('logic_submissions').insert({
      developer_address: devAddress.toLowerCase(),
      ipfs_cid: cid,
      game_name: gameName,
      code_snapshot: bundledContent,
      status: 'PENDING'
    });

    if (error) throw error;

    console.log(chalk.blue.bold('\nSUCCESS: Logic submitted.'));
    console.log(chalk.gray('Status: PENDING_ADMIN_REVIEW'));
    console.log(chalk.gray('Your game will appear in the Arena Discovery once verified.\n'));

  } catch (err: any) {
    console.log(chalk.red(`ERROR: Deployment Failed: ${err.message}`));
  } finally {
    // Cleanup
    if (fs.existsSync(tempBundlePath)) fs.unlinkSync(tempBundlePath);
  }
}
