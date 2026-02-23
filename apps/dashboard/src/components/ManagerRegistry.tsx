'use client';

import { useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';

export function ManagerRegistry() {
  const { address, isConnected } = useAccount();
  const { authenticated, user, ready } = usePrivy();
  const lastRegisteredAddress = useRef<string | null>(null);

  useEffect(() => {
    async function registerManager(walletAddress: string) {
      const lowerAddress = walletAddress.toLowerCase();
      if (lastRegisteredAddress.current === lowerAddress) return;

      console.log('ManagerRegistry: Initiating registration for', lowerAddress);
      
      try {
        const { data, error } = await supabase
          .from('manager_profiles')
          .upsert(
            { address: lowerAddress }, 
            { onConflict: 'address' }
          )
          .select();

        if (error) {
          console.error('ManagerRegistry: Supabase Error:', error.message);
        } else {
          console.log('ManagerRegistry: Successfully registered!', data);
          lastRegisteredAddress.current = lowerAddress;
        }
      } catch (err) {
        console.error('ManagerRegistry: Unexpected Error:', err);
      }
    }

    const activeAddress = address || user?.wallet?.address;

    if (ready && (isConnected || authenticated) && activeAddress) {
      registerManager(activeAddress);
    }
  }, [address, isConnected, authenticated, user, ready]);

  return null;
}
