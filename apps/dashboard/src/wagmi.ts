import { http, createConfig } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';
import { coinbaseWallet } from 'wagmi/connectors';

export const config = createConfig({
  chains: [baseSepolia],
  connectors: [
    coinbaseWallet({
      appName: 'BotByte Protocol',
      preference: 'all', // 'all' or 'smartWalletOnly'
    }),
  ],
  transports: {
    [baseSepolia.id]: http(),
  },
});
