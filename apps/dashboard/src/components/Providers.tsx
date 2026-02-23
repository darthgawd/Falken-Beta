'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OnchainKitProvider } from '@coinbase/onchainkit';
import { baseSepolia } from 'viem/chains';
import { WagmiProvider } from 'wagmi';
import { PrivyProvider } from '@privy-io/react-auth';
import { ReactNode, useState, useEffect } from 'react';
import { config } from '../wagmi';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [mounted, setMounted] = useState(false);
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="min-h-screen bg-black" />; // Blank skeleton during hydration
  }

  if (!appId || appId === 'insert-your-privy-app-id') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-8 text-center">
        <div className="max-w-md space-y-4">
          <div className="text-red-500 font-bold text-xl uppercase tracking-tighter">Configuration Required</div>
          <p className="text-zinc-500 text-sm">
            Please set <code className="text-blue-500">NEXT_PUBLIC_PRIVY_APP_ID</code> in your <code className="text-white">.env</code> file. 
            Get one at <a href="https://dashboard.privy.io" className="underline text-zinc-300">dashboard.privy.io</a>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      onSuccess={(user) => console.log('Successfully logged in:', user)}
      onError={(error) => console.error('Privy Login Error:', error)}
      config={{
        loginMethods: ['email', 'wallet', 'google', 'twitter', 'farcaster'],
        appearance: {
          theme: 'dark',
          accentColor: '#3b82f6', // blue-500
          showWalletLoginFirst: false,
        },
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
        defaultChain: baseSepolia,
        supportedChains: [baseSepolia],
      }}
    >
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <OnchainKitProvider
            chain={baseSepolia}
            apiKey={process.env.NEXT_PUBLIC_COINBASE_API_KEY}
          >
            {children}
          </OnchainKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </PrivyProvider>
  );
}
