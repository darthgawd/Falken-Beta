import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pino from 'pino';
import { startIndexer } from 'indexer';
import { Watcher } from '@falken/vm/Watcher';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const logger = (pino as any)({ name: 'orchestrator' });

async function main() {
  const ESCROW_ADDRESS = process.env.FISE_ESCROW_ADDRESS as `0x${string}`;
  const REGISTRY_ADDRESS = process.env.LOGIC_REGISTRY_ADDRESS as `0x${string}`;

  if (!ESCROW_ADDRESS || !REGISTRY_ADDRESS) {
    logger.error('Missing FISE_ESCROW_ADDRESS or LOGIC_REGISTRY_ADDRESS');
    process.exit(1);
  }

  logger.info('=== FALKEN Orchestrator starting ===');

  // 1. Start indexer (backfills then watches — runs in background)
  logger.info('Starting Indexer...');
  startIndexer().catch(err => logger.error({ err }, 'Indexer crashed'));

  // 2. Start Watcher (event-driven referee pipeline)
  logger.info('Starting Watcher...');
  const watcher = new Watcher();
  await watcher.start(ESCROW_ADDRESS, REGISTRY_ADDRESS);
}

main().catch(err => {
  logger.error({ err }, 'Orchestrator fatal error');
  process.exit(1);
});
