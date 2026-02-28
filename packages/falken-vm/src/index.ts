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
  const ESCROW_ADDRESS = process.env.FISE_ESCROW_ADDRESS as `0x${string}`;
  const REGISTRY_ADDRESS = process.env.LOGIC_REGISTRY_ADDRESS as `0x${string}`;

  if (!ESCROW_ADDRESS || !REGISTRY_ADDRESS) {
    logger.error('CRITICAL_MISSING_CONFIG: FISE_ESCROW_ADDRESS or LOGIC_REGISTRY_ADDRESS');
    process.exit(1);
  }

  const watcher = new Watcher();
  
  logger.info('FALKEN_VM V1.0.0 STARTING...');
  await watcher.start(ESCROW_ADDRESS, REGISTRY_ADDRESS);
}

main().catch((err) => {
  logger.error({ err }, 'ROOT_PROCESS_CRASH');
  process.exit(1);
});
