import { useState, useEffect } from 'react';

export function useEthPrice() {
  const [price, setPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPrice() {
      try {
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
        const data = await res.json();
        setPrice(data.ethereum.usd);
      } catch (err) {
        console.error('Failed to fetch ETH price:', err);
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
