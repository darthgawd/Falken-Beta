import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Watcher } from './Watcher.js';
import pino from 'pino';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config(); // Fallback to local

const logger = (pino as any)({ name: 'falken-vm-root' });

async function main() {
  // V4: Support multiple contract types
  const POKER_ENGINE_ADDRESS = process.env.POKER_ENGINE_ADDRESS as `0x${string}`;
  const REGISTRY_ADDRESS = process.env.LOGIC_REGISTRY_ADDRESS as `0x${string}`;

  if (!POKER_ENGINE_ADDRESS || !REGISTRY_ADDRESS) {
    logger.error('CRITICAL_MISSING_CONFIG: POKER_ENGINE_ADDRESS or LOGIC_REGISTRY_ADDRESS');
    logger.error('V4 requires POKER_ENGINE_ADDRESS (not FISE_ESCROW_ADDRESS)');
    process.exit(1);
  }

  const watcher = new Watcher();

  // V4: Pass contracts array with type information
  const contracts = [
    { address: POKER_ENGINE_ADDRESS, type: 'POKER_ENGINE' as const }
    // Future: Add FISE_ESCROW_V4_ADDRESS here when ready
  ];

  logger.info('FALKEN_VM V4.0.0 STARTING...');
  logger.info({ contracts: contracts.map(c => c.address) }, 'WATCHING_CONTRACTS');

  await watcher.start(contracts, REGISTRY_ADDRESS);
}

main().catch((err) => {
  logger.error({ err }, 'ROOT_PROCESS_CRASH');
  process.exit(1);
});
