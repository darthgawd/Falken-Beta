import pino from 'pino';
import crypto from 'node:crypto';

const logger = (pino as any)({ name: 'falken-fetcher' });

const MAX_LOGIC_SIZE = 1024 * 1024; // 1MB limit for game logic

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
   * Fetches raw JS logic from IPFS with gateway failover and size limits.
   */
  async fetchLogic(cid: string): Promise<string> {
    logger.info({ cid }, 'FETCHING_LOGIC_FROM_IPFS');

    for (const gateway of this.gateways) {
      try {
        const url = `${gateway}${cid}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        
        if (response.ok) {
          const code = await response.text();
          
          if (code.length > MAX_LOGIC_SIZE) {
              throw new Error(`Logic exceeds size limit of ${MAX_LOGIC_SIZE} bytes`);
          }

          // In a full implementation, we would verify the base58 CID against the SHA256 hash here.
          // For now, we ensure the size is bounded to prevent OOM attacks.
          
          logger.info({ cid, gateway, size: code.length }, 'FETCH_SUCCESS');
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
