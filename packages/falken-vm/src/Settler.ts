import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import pino from 'pino';
import { RoundResolution } from './Referee.js';
import { EscrowConfig } from './Watcher.js';

const logger = (pino as any)({ name: 'falken-settler-v4' });

// V4 PokerEngine ABI
const POKER_ENGINE_ABI = [
  { name: 'resolveRound', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'matchId', type: 'uint256' }, { name: 'roundWinnerIdx', type: 'uint8' }], outputs: [] },
  { name: 'resolveRoundSplit', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'matchId', type: 'uint256' }, { name: 'res', type: 'tuple', components: [{ name: 'winnerIndices', type: 'uint8[]' }, { name: 'splitBps', type: 'uint256[]' }] }], outputs: [] },
  { name: 'advanceStreet', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'matchId', type: 'uint256' }], outputs: [] }
] as const;

// V4 FiseEscrow ABI
const FISE_ESCROW_ABI = [
  { name: 'resolveFiseRound', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'matchId', type: 'uint256' }, { name: 'roundWinnerIdx', type: 'uint8' }], outputs: [] }
] as const;

export class Settler {
  private account = privateKeyToAccount((process.env.REFEREE_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001') as `0x${string}`);
  private registryAddress: `0x${string}` = '0x0000000000000000000000000000000000000000';

  private client = createWalletClient({
    account: this.account,
    chain: baseSepolia,
    transport: http(process.env.RPC_URL)
  }).extend(publicActions);

  public initializeRegistry(registryAddress: `0x${string}`) {
    this.registryAddress = registryAddress;
  }

  /**
   * Main settlement entry point with routing logic for multiple contracts.
   */
  async settle(
    config: EscrowConfig,
    matchId: bigint,
    resolution: RoundResolution,
    street: number,
    maxStreets: number,
    description?: string
  ): Promise<`0x${string}`> {
    const isFinalStreet = street + 1 >= maxStreets;

    if (config.type === 'POKER_ENGINE') {
      if (!isFinalStreet) {
        return this.advanceStreet(config.address, matchId);
      }
      if (resolution.splitResult) {
        return this.resolveRoundSplit(config.address, matchId, resolution.splitResult.winnerIndices, resolution.splitResult.splitBps, description);
      }
      return this.resolveRoundPoker(config.address, matchId, resolution.winner ?? 255, description);
    } else {
      // FISE_ESCROW logic
      return this.resolveFiseRound(config.address, matchId, resolution.winner ?? 255, description);
    }
  }

  private async resolveRoundPoker(escrowAddress: `0x${string}`, matchId: bigint, roundWinnerIdx: number, description?: string): Promise<`0x${string}`> {
    logger.info({ matchId: matchId.toString(), roundWinnerIdx, description }, 'POKER_SINGLE_RESOLUTION');
    const nonce = await this.client.getTransactionCount({ address: this.account.address, blockTag: 'pending' });
    const hash = await this.client.writeContract({ address: escrowAddress, abi: POKER_ENGINE_ABI, functionName: 'resolveRound', args: [matchId, roundWinnerIdx], nonce });
    await this.client.waitForTransactionReceipt({ hash });
    if (description) await this.persistDescription(escrowAddress, matchId, description);
    return hash;
  }

  private async resolveRoundSplit(escrowAddress: `0x${string}`, matchId: bigint, winnerIndices: number[], splitBps: number[], description?: string): Promise<`0x${string}`> {
    logger.info({ matchId: matchId.toString(), winnerIndices, splitBps, description }, 'POKER_SPLIT_RESOLUTION');
    const nonce = await this.client.getTransactionCount({ address: this.account.address, blockTag: 'pending' });
    const resolution = { winnerIndices, splitBps: splitBps.map(b => BigInt(b)) };
    const hash = await this.client.writeContract({ address: escrowAddress, abi: POKER_ENGINE_ABI, functionName: 'resolveRoundSplit', args: [matchId, resolution], nonce });
    await this.client.waitForTransactionReceipt({ hash });
    if (description) await this.persistDescription(escrowAddress, matchId, description);
    return hash;
  }

  private async advanceStreet(escrowAddress: `0x${string}`, matchId: bigint): Promise<`0x${string}`> {
    logger.info({ matchId: matchId.toString() }, 'POKER_STREET_ADVANCE');
    const nonce = await this.client.getTransactionCount({ address: this.account.address, blockTag: 'pending' });
    const hash = await this.client.writeContract({ address: escrowAddress, abi: POKER_ENGINE_ABI, functionName: 'advanceStreet', args: [matchId], nonce });
    await this.client.waitForTransactionReceipt({ hash });
    return hash;
  }

  private async resolveFiseRound(escrowAddress: `0x${string}`, matchId: bigint, roundWinnerIdx: number, description?: string): Promise<`0x${string}`> {
    logger.info({ matchId: matchId.toString(), roundWinnerIdx, description }, 'FISE_RESOLUTION');
    const nonce = await this.client.getTransactionCount({ address: this.account.address, blockTag: 'pending' });
    const hash = await this.client.writeContract({ address: escrowAddress, abi: FISE_ESCROW_ABI, functionName: 'resolveFiseRound', args: [matchId, roundWinnerIdx], nonce });
    await this.client.waitForTransactionReceipt({ hash });
    if (description) await this.persistDescription(escrowAddress, matchId, description);
    return hash;
  }

  private async persistDescription(escrowAddress: `0x${string}`, matchId: bigint, description: string) {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const dbMatchId = `${escrowAddress.toLowerCase()}-${matchId.toString()}`;

      const { data: match } = await supabase.from('matches').select('current_round').eq('match_id', dbMatchId).single();
      const roundNum = match?.current_round || 1;

      await supabase.from('rounds').update({ state_description: description }).match({ match_id: dbMatchId, round_number: roundNum });
      logger.info({ dbMatchId, roundNum }, 'STATE_DESCRIPTION_PERSISTED');
    } catch (dbErr: any) {
      logger.warn({ err: dbErr.message }, 'FAILED_TO_PERSIST_STATE_DESCRIPTION');
    }
  }
}
