import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { Referee } from './Referee.js';
import { Reconstructor } from './Reconstructor.js';
import { Settler } from './Settler.js';
import { Fetcher } from './Fetcher.js';
import pino from 'pino';
import fs from 'fs';
import path from 'path';

const logger = (pino as any)({ name: 'falken-watcher-v4' });

// Need ABIs for both V4 escrow types
const POKER_ENGINE_ABI = [
  { name: 'matchCounter', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getMatch', type: 'function', stateMutability: 'view', inputs: [{ name: 'matchId', type: 'uint256' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'players', type: 'address[]' }, { name: 'stake', type: 'uint256' }, { name: 'totalPot', type: 'uint256' }, { name: 'logicId', type: 'bytes32' }, { name: 'maxPlayers', type: 'uint8' }, { name: 'maxRounds', type: 'uint8' }, { name: 'currentRound', type: 'uint8' }, { name: 'wins', type: 'uint8[]' }, { name: 'drawCounter', type: 'uint8' }, { name: 'winsRequired', type: 'uint8' }, { name: 'status', type: 'uint8' }, { name: 'winner', type: 'address' }, { name: 'createdAt', type: 'uint256' }] }] },
  { name: 'getPokerState', type: 'function', stateMutability: 'view', inputs: [{ name: 'matchId', type: 'uint256' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'phase', type: 'uint8' }, { name: 'betStructure', type: 'uint8' }, { name: 'maxStreets', type: 'uint8' }, { name: 'street', type: 'uint8' }, { name: 'activePlayers', type: 'uint8' }, { name: 'raiseCount', type: 'uint8' }, { name: 'playersToAct', type: 'uint8' }, { name: 'currentBet', type: 'uint256' }, { name: 'maxBuyIn', type: 'uint256' }, { name: 'commitDeadline', type: 'uint256' }, { name: 'betDeadline', type: 'uint256' }, { name: 'revealDeadline', type: 'uint256' }, { name: 'folded', type: 'bool[]' }, { name: 'streetBets', type: 'uint256[]' }] }] },
  { name: 'roundRevealCount', type: 'function', stateMutability: 'view', inputs: [{ name: 'matchId', type: 'uint256' }, { name: 'round', type: 'uint8' }], outputs: [{ type: 'uint8' }] },
  { name: 'MoveRevealed', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'round', type: 'uint8', indexed: false }, { name: 'player', type: 'address', indexed: true }, { name: 'move', type: 'bytes32', indexed: false }] }
] as const;

const FISE_ESCROW_ABI = [
  { name: 'matchCounter', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getMatch', type: 'function', stateMutability: 'view', inputs: [{ name: 'matchId', type: 'uint256' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'players', type: 'address[]' }, { name: 'stake', type: 'uint256' }, { name: 'totalPot', type: 'uint256' }, { name: 'logicId', type: 'bytes32' }, { name: 'maxPlayers', type: 'uint8' }, { name: 'maxRounds', type: 'uint8' }, { name: 'currentRound', type: 'uint8' }, { name: 'wins', type: 'uint8[]' }, { name: 'drawCounter', type: 'uint8' }, { name: 'winsRequired', type: 'uint8' }, { name: 'status', type: 'uint8' }, { name: 'winner', type: 'address' }, { name: 'createdAt', type: 'uint256' }] }] },
  { name: 'getFiseState', type: 'function', stateMutability: 'view', inputs: [{ name: 'matchId', type: 'uint256' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'phase', type: 'uint8' }, { name: 'commitDeadline', type: 'uint256' }, { name: 'revealDeadline', type: 'uint256' }] }] },
  { name: 'roundRevealCount', type: 'function', stateMutability: 'view', inputs: [{ name: 'matchId', type: 'uint256' }, { name: 'round', type: 'uint8' }], outputs: [{ type: 'uint8' }] },
  { name: 'MoveRevealed', type: 'event', inputs: [{ name: 'matchId', type: 'uint256', indexed: true }, { name: 'round', type: 'uint8', indexed: false }, { name: 'player', type: 'address', indexed: true }, { name: 'move', type: 'bytes32', indexed: false }] }
] as const;

const LOGIC_REGISTRY_ABI = [
  { name: 'getGameLogic', type: 'function', stateMutability: 'view', inputs: [{ name: 'logicId', type: 'bytes32' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'ipfsCid', type: 'string' }, { name: 'developer', type: 'address' }, { name: 'isVerified', type: 'bool' }, { name: 'isActive', type: 'bool' }, { name: 'bettingEnabled', type: 'bool' }, { name: 'maxStreets', type: 'uint8' }, { name: 'createdAt', type: 'uint256' }, { name: 'totalVolume', type: 'uint256' }] }] }
] as const;

export interface EscrowConfig {
  address: `0x${string}`;
  type: 'POKER_ENGINE' | 'FISE_ESCROW';
}

export class Watcher {
  private client = createPublicClient({ chain: baseSepolia, transport: http(process.env.RPC_URL) });
  private referee = new Referee();
  private reconstructor = new Reconstructor();
  private settler = new Settler();
  private fetcher = new Fetcher();

  // Persistence for settled rounds and retries (Fix #14, #15)
  private stateFilePath = path.join(process.cwd(), '.watcher-state.json');
  private settledRounds: Set<string> = new Set();
  private retryQueue: Map<string, { config: EscrowConfig, matchId: bigint, attempts: number, nextRetry: number }> = new Map();
  private registryAddress: `0x${string}` = '0x0000000000000000000000000000000000000000';

  constructor() {
    this.loadState();
    // Start retry queue processor
    setInterval(() => this.processRetryQueue(), 15000);
  }

  private loadState() {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const data = JSON.parse(fs.readFileSync(this.stateFilePath, 'utf8'));
        this.settledRounds = new Set(data.settledRounds || []);
        logger.info(`Loaded ${this.settledRounds.size} settled rounds from persistence.`);
      }
    } catch (e) {
      logger.error('Failed to load watcher state');
    }
  }

  private saveState() {
    try {
      fs.writeFileSync(this.stateFilePath, JSON.stringify({
        settledRounds: Array.from(this.settledRounds)
      }));
    } catch (e) {
      logger.error('Failed to save watcher state');
    }
  }

  async start(contracts: EscrowConfig[], registryAddress: `0x${string}`) {
    this.settler.initializeRegistry(registryAddress);
    this.registryAddress = registryAddress;
    logger.info({ contracts, registryAddress }, 'WATCHER_V4_INITIALIZED');

    // Startup scan: Check ALL active matches (Fix #16)
    for (const config of contracts) {
      await this.scanActiveMatches(config, registryAddress);
    }

    // Watch for new events on all contracts (Fix #10)
    for (const config of contracts) {
      const abi = config.type === 'POKER_ENGINE' ? POKER_ENGINE_ABI : FISE_ESCROW_ABI;
      this.client.watchContractEvent({
        address: config.address,
        abi: abi as any,
        eventName: 'MoveRevealed',
        onLogs: async (logs) => {
          for (const log of logs) {
            const matchId = (log as any).args?.matchId;
            if (matchId) await this.processMatch(BigInt(matchId), config, registryAddress);
          }
        }
      });
    }
  }

  private async scanActiveMatches(config: EscrowConfig, registryAddress: `0x${string}`) {
    try {
      const abi = config.type === 'POKER_ENGINE' ? POKER_ENGINE_ABI : FISE_ESCROW_ABI;
      const counter = await this.client.readContract({
        address: config.address,
        abi: abi as any,
        functionName: 'matchCounter'
      }) as bigint;

      const matchCount = Number(counter);
      logger.info({ matchCount, escrowAddress: config.address }, 'Scanning all active matches...');

      // Fix #16: Scan all active matches, not just the last 20
      for (let i = 1; i <= matchCount; i++) {
        try {
          const matchData = await this.client.readContract({
            address: config.address,
            abi: abi as any,
            functionName: 'getMatch',
            args: [BigInt(i)]
          }) as any;

          if (Number(matchData.status) !== 1) continue; // Only process ACTIVE matches

          let phase = 0;
          let activePlayers = matchData.players.length;

          if (config.type === 'POKER_ENGINE') {
            const state = await this.client.readContract({ address: config.address, abi: POKER_ENGINE_ABI, functionName: 'getPokerState', args: [BigInt(i)] }) as any;
            phase = Number(state.phase);
            activePlayers = Number(state.activePlayers);
          } else {
            const state = await this.client.readContract({ address: config.address, abi: FISE_ESCROW_ABI, functionName: 'getFiseState', args: [BigInt(i)] }) as any;
            phase = Number(state.phase);
          }

          // POKER_ENGINE Reveal is phase 2. FISE_ESCROW Reveal is phase 1.
          const revealPhase = config.type === 'POKER_ENGINE' ? 2 : 1;

          if (phase === revealPhase) {
            const revealCount = await this.client.readContract({
              address: config.address,
              abi: abi as any,
              functionName: 'roundRevealCount',
              args: [BigInt(i), matchData.currentRound]
            }) as number;

            if (revealCount >= activePlayers) {
              logger.info({ matchId: i }, 'Found match ready for resolution');
              await this.processMatch(BigInt(i), config, registryAddress);
            }
          }
        } catch (err) {
          // Skip errors for individual matches to not halt the loop
        }
      }
    } catch (err: any) {
      logger.error({ err: err.message, contract: config.address }, 'Failed to scan active matches');
    }
  }

  private async processMatch(onChainMatchId: bigint, config: EscrowConfig, registryAddress: `0x${string}`) {
    const dbMatchId = `${config.address.toLowerCase()}-${onChainMatchId.toString()}`;
    let currentRoundNum = 0;
    let currentStreet = 0;

    try {
      logger.info({ matchId: onChainMatchId.toString() }, 'PROCESS_MATCH_START');
      const abi = config.type === 'POKER_ENGINE' ? POKER_ENGINE_ABI : FISE_ESCROW_ABI;
      
      logger.info({ matchId: onChainMatchId.toString() }, 'FETCHING_MATCH_DATA');
      const matchData = await this.client.readContract({ address: config.address, abi: abi as any, functionName: 'getMatch', args: [onChainMatchId] }) as any;
      logger.info({ matchId: onChainMatchId.toString(), players: matchData.players?.length }, 'GOT_MATCH_DATA');
      
      const { players, currentRound, status, logicId, stake } = matchData;
      currentRoundNum = Number(currentRound);

      let phase = 0;
      let activePlayers = players.length;
      let maxStreets = 1;

      if (config.type === 'POKER_ENGINE') {
        logger.info({ matchId: onChainMatchId.toString() }, 'FETCHING_POKER_STATE');
        const state = await this.client.readContract({ address: config.address, abi: POKER_ENGINE_ABI, functionName: 'getPokerState', args: [onChainMatchId] }) as any;
        logger.info({ matchId: onChainMatchId.toString(), phase: Number(state.phase), street: Number(state.street) }, 'GOT_POKER_STATE');
        phase = Number(state.phase);
        currentStreet = Number(state.street);
        activePlayers = Number(state.activePlayers);
        maxStreets = Number(state.maxStreets);
      } else {
        const state = await this.client.readContract({ address: config.address, abi: FISE_ESCROW_ABI, functionName: 'getFiseState', args: [onChainMatchId] }) as any;
        phase = Number(state.phase);
      }

      const revealPhase = config.type === 'POKER_ENGINE' ? 2 : 1;
      const roundKey = `${onChainMatchId}-${currentRoundNum}-${currentStreet}`;
      logger.info({ matchId: onChainMatchId.toString(), status: Number(status), phase, revealPhase }, 'CHECKING_STATUS_PHASE');
      if (Number(status) !== 1 || phase !== revealPhase) {
        logger.info({ matchId: onChainMatchId.toString(), status: Number(status) }, 'EARLY_RETURN_STATUS_PHASE');
        // Remove from retry queue if match is no longer active (settled/voided)
        if (Number(status) > 1) {
          this.retryQueue.delete(roundKey);
          logger.info({ matchId: onChainMatchId.toString() }, 'Removed from retry queue - match settled/voided');
        }
        return;
      }

      // roundKey already declared above
      if (this.settledRounds.has(roundKey)) {
        logger.info({ matchId: onChainMatchId.toString(), roundKey }, 'EARLY_RETURN_ALREADY_SETTLED');
        return;
      }

      const revealCount = await this.client.readContract({ address: config.address, abi: abi as any, functionName: 'roundRevealCount', args: [onChainMatchId, currentRound] }) as number;
      if (revealCount < activePlayers) return;

      this.settledRounds.add(roundKey);
      this.saveState(); // Persist that we are handling this

      logger.info({ matchId: onChainMatchId.toString(), round: currentRoundNum, street: currentStreet }, 'ALL_PLAYERS_REVEALED // Processing');

      const expectedMoves = Number(activePlayers);
      const { moves } = await this.getSyncedMoves(dbMatchId, expectedMoves, config.address, onChainMatchId);

      if (moves.length < expectedMoves) {
        logger.warn({ matchId: onChainMatchId.toString(), round: currentRoundNum }, 'DB_NOT_SYNCED');
        this.settledRounds.delete(roundKey);
        this.saveState();
        return;
      }

      const logicEntry = await this.client.readContract({ address: registryAddress, abi: LOGIC_REGISTRY_ABI, functionName: 'getGameLogic', args: [logicId] }) as any;
      const ipfsCID = logicEntry.ipfsCid;
      if (!ipfsCID) throw new Error("EMPTY_CID_IN_REGISTRY");

      const jsCode = await this.fetcher.fetchLogic(ipfsCID);

      const refereeContext = {
        players: players.map((p: string) => p.toLowerCase()),
        stake: stake.toString(),
        matchId: onChainMatchId.toString(),
        round: currentRoundNum,
        config: { street: currentStreet, maxStreets }
      };

      const resolution = await this.referee.resolveRound(jsCode, refereeContext, moves);

      if (resolution) {
        logger.info({ dbMatchId, winner: resolution.winner }, 'ROUND_RESOLVED');
        await this.settler.settle(config, onChainMatchId, resolution, currentStreet, maxStreets, resolution.description);
      } else {
        await this.settler.settle(config, onChainMatchId, { winner: 255, description: "Pending." }, currentStreet, maxStreets);
      }
      
      // Cleanup retry queue on success
      this.retryQueue.delete(roundKey);

    } catch (err: any) {
      logger.error({ matchId: onChainMatchId.toString(), err: err.message }, 'VM_PROCESSING_FAULT');
      
      // Fix #15: Add to retry queue instead of dropping
      const roundKey = `${onChainMatchId}-${currentRoundNum}-${currentStreet}`;
      this.settledRounds.delete(roundKey); // Allow retry
      this.saveState();

      const existingRetry = this.retryQueue.get(roundKey);
      const attempts = existingRetry ? existingRetry.attempts + 1 : 1;
      
      if (attempts <= 5) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempts), 60000); // Exponential backoff up to 60s
        logger.info({ matchId: onChainMatchId.toString(), attempts, nextRetryIn: backoffMs/1000 }, 'Added to retry queue');
        this.retryQueue.set(roundKey, {
          config,
          matchId: onChainMatchId,
          attempts,
          nextRetry: Date.now() + backoffMs
        });
      } else {
        logger.error({ matchId: onChainMatchId.toString() }, 'Max settlement retries reached. Manual intervention required.');
      }
    }
  }

  private async processRetryQueue() {
    const now = Date.now();
    for (const [key, retry] of this.retryQueue.entries()) {
      if (now >= retry.nextRetry) {
        logger.info({ matchId: retry.matchId.toString() }, 'Processing retry queue item');
        await this.processMatch(retry.matchId, retry.config, this.registryAddress);
      }
    }
  }

  private async getSyncedMoves(dbMatchId: string, expectedCount: number, escrowAddress: `0x${string}`, onChainMatchId: bigint, maxRetries = 10, delayMs = 2000) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await this.reconstructor.getMatchHistory(dbMatchId, escrowAddress, onChainMatchId);
        if (result.moves && result.moves.length >= expectedCount) return result;
        await new Promise(r => setTimeout(r, delayMs));
      } catch (err: any) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
    return { context: null as any, moves: [] };
  }
}
