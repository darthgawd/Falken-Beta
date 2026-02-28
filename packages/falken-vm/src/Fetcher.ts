import pino from 'pino';

const logger = (pino as any)({ name: 'falken-fetcher' });

/**
 * Falken IPFS Fetcher
 * Retrieves immutable game logic from the decentralized web.
 */
export class Fetcher {
  private gateways = [
    'https://gateway.pinata.cloud/ipfs/',
    'https://cloudflare-ipfs.com/ipfs/',
    'https://ipfs.io/ipfs/'
  ];

  /**
   * Fetches raw JS logic from IPFS with gateway failover.
   */
  async fetchLogic(cid: string): Promise<string> {
    logger.info({ cid }, 'FETCHING_LOGIC_FROM_IPFS');

    for (const gateway of this.gateways) {
      try {
        const url = `${gateway}${cid}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        
        if (response.ok) {
          const code = await response.text();
          logger.info({ cid, gateway }, 'FETCH_SUCCESS');
          return code;
        }
      } catch (err: any) {
        logger.warn({ gateway, err: err.message }, 'GATEWAY_TIMEOUT_OR_FAILURE');
        continue; // Try next gateway
      }
    }

    throw new Error(`IPFS_FETCH_FAILED: All gateways exhausted for CID ${cid}`);
  }
}
