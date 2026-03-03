import { startIndexer } from './index.js';

startIndexer().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
