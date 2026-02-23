import { SimpleAgent } from './SimpleAgent.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const pk = process.env.AGENT_PRIVATE_KEY;
  if (!pk) {
    console.error('❌ AGENT_PRIVATE_KEY missing in .env');
    process.exit(1);
  }

  const agent = new SimpleAgent(pk);
  await agent.run();
}

main().catch(console.error);
