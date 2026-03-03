import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');

const NEW_ADDRESSES = {
  ESCROW_ADDRESS: '0x08d96424f10E7D7c356d7E770b03c88741c33BfF',
  FISE_ESCROW_ADDRESS: '0x08d96424f10E7D7c356d7E770b03c88741c33BfF',
  LOGIC_REGISTRY_ADDRESS: '0xc87d466e9F2240b1d7caB99431D1C80a608268Df',
  PRICE_PROVIDER_ADDRESS: '0xFd2f3194b866DbE7115447B6b79C0972CcEDE3Ca',
  RPS_LOGIC_ADDRESS: '0x3f23D3Fb74d653f3CA4ec30C9D8BeB883a7B3C02',
  START_BLOCK: '38233444'
};

function updateEnv() {
  let content = fs.readFileSync(envPath, 'utf8');
  let lines = content.split('
');

  for (const [key, value] of Object.entries(NEW_ADDRESSES)) {
    // Update main var
    const mainRegex = new RegExp(`^${key}=.*`, 'm');
    if (mainRegex.test(content)) {
      content = content.replace(mainRegex, `${key}=${value}`);
    } else {
      content += `
${key}=${value}`;
    }

    // Update NEXT_PUBLIC var if it exists
    const publicVar = `NEXT_PUBLIC_${key}`;
    const publicRegex = new RegExp(`^${publicVar}=.*`, 'm');
    if (publicRegex.test(content)) {
      content = content.replace(publicRegex, `${publicVar}=${value}`);
    }
  }

  fs.writeFileSync(envPath, content);
  console.log('✅ .env file updated with new contract addresses and START_BLOCK.');
}

updateEnv();
