import { execSync, spawn } from 'child_process';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const RPC_URL = "http://127.0.0.1:8545";

export async function ensureAnvil() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  try {
    await provider.getBlockNumber();
    console.log("✅ Anvil is already running.");
    return true;
  } catch (e) {
    console.log("🚀 Starting fresh Anvil fork...");
    
    // Start Anvil in background
    const anvil = spawn('anvil', [
      '--fork-url', process.env.RPC_URL!,
      '--chain-id', '84532',
      '--host', '127.0.0.1'
    ], {
      detached: true,
      stdio: 'ignore'
    });
    
    anvil.unref();

    // Wait for anvil to be ready
    for (let i = 0; i < 10; i++) {
      try {
        await provider.getBlockNumber();
        console.log("✅ Anvil started successfully.");
        return true;
      } catch (err) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    throw new Error("Failed to start Anvil");
  }
}
