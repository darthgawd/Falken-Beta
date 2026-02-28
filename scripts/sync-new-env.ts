import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(__dirname, '../.env');
const dashEnv = path.resolve(__dirname, '../apps/dashboard/.env');

const NEW_ADDRESSES = {
  ESCROW_ADDRESS: '0x8e8048213960b8a1126cB56FaF8085DccE35DAc0',
  FISE_ESCROW_ADDRESS: '0x8e8048213960b8a1126cB56FaF8085DccE35DAc0',
  LOGIC_REGISTRY_ADDRESS: '0xF32BF92fcd1C07F515Ee82D4169c8B5dF4eD6bA8',
  PRICE_PROVIDER_ADDRESS: '0x2b04fE68e3f3B8F14Dc04C7E42563197F27Fa84E',
  RPS_LOGIC_ADDRESS: '0xc8d20Ab9E0A37a4Bdec0f0e839170ef2E372FeaA',
  START_BLOCK: '38269176'
};

function updateFile(p) {
  if (!fs.existsSync(p)) return;
  let content = fs.readFileSync(p, 'utf8');
  for (const [key, value] of Object.entries(NEW_ADDRESSES)) {
    const mainRegex = new RegExp(`^${key}=.*`, 'm');
    content = mainRegex.test(content) ? content.replace(mainRegex, `${key}=${value}`) : content + `
${key}=${value}`;
    const pubVar = `NEXT_PUBLIC_${key}`;
    const pubRegex = new RegExp(`^${pubVar}=.*`, 'm');
    content = pubRegex.test(content) ? content.replace(pubRegex, `${pubVar}=${value}`) : content + `
${pubVar}=${value}`;
  }
  fs.writeFileSync(p, content);
  console.log(`✅ Updated ${p}`);
}

updateFile(rootEnv);
updateFile(dashEnv);
