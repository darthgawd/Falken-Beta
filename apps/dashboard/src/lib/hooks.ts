import { useState, useEffect } from 'react';

export function useEthPrice() {
  const [price, setPrice] = useState<number | null>(2500); // Default fallback
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPrice() {
      try {
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
        if (!res.ok) throw new Error('API_UNAVAILABLE');
        const data = await res.json();
        if (data.ethereum?.usd) {
          setPrice(data.ethereum.usd);
        }
      } catch (err) {
        // Silently fail to fallback to avoid console noise in dev
        console.warn('ETH_PRICE_SYNC: Using cache/fallback.');
      } finally {
        setLoading(false);
      }
    }

    fetchPrice();
    // Refresh every 60 seconds
    const interval = setInterval(fetchPrice, 60000);
    return () => clearInterval(interval);
  }, []);

  return { price, loading };
}
