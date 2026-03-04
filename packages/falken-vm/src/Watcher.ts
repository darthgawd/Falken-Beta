import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { Referee } from './Referee.js';
import { Reconstructor } from './Reconstructor.js';
import { Settler } from './Settler.js';
import { Fetcher } from './Fetcher.js';
import pino from 'pino';

const logger = (pino as any)({ name: 'falken-watcher' });

const FISE_ESCROW_ABI = [
  {
    name: 'MoveRevealed',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'roundNumber', type: 'uint8' },
      { name: 'player', type: 'address', indexed: true },
      { name: 'move', type: 'uint8' }
    ]
  },
  {
    name: 'getMatch',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_matchId', type: 'uint256' }],
    outputs: [{ name: '', type: 'tuple', components: [
      { name: 'playerA', type: 'address' }, { name: 'playerB', type: 'address' }, { name: 'stake', type: 'uint256' }, { name: 'gameLogic', type: 'address' },
      { name: 'winsA', type: 'uint8' }, { name: 'winsB', type: 'uint8' }, { name: 'currentRound', type: 'uint8' }, { name: 'drawCounter', type: 'uint8' },
      { name: 'phase', type: 'uint8' }, { name: 'status', type: 'uint8' }, { name: 'commitDeadline', type: 'uint256' }, { name: 'revealDeadline', type: 'uint256' }
    ] }]
  },
  {
    name: 'getRoundStatus',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'matchId', type: 'uint256' }, { name: 'round', type: 'uint8' }, { name: 'player', type: 'address' }],
    outputs: [{ name: 'commitHash', type: 'bytes32' }, { name: 'revealed', type: 'bool' }]
  },
  {
    name: 'fiseMatches',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'bytes32' }]
  }
] as const;

const LOGIC_REGISTRY_ABI = [
  {
    name: 'registry',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ name: 'ipfsCID', type: 'string' }, { name: 'developer', type: 'address' }, { name: 'isVerified', type: 'bool' }, { name: 'createdAt', type: 'uint256' }, { name: 'totalVolume', type: 'uint256' }]
  }
] as const;

export class Watcher {
  private client = createPublicClient({ chain: baseSepolia, transport: http(process.env.RPC_URL) });
  private referee = new Referee();
  private reconstructor = new Reconstructor();
  private settler = new Settler();
  private fetcher = new Fetcher();
  private settledRounds = new Set<string>();

  async start(escrowAddress: `0x${string}`, registryAddress: `0x${string}`) {
    logger.info({ escrowAddress, registryAddress }, 'WATCHER_INITIALIZED');
    this.client.watchContractEvent({
      address: escrowAddress,
      abi: FISE_ESCROW_ABI,
      eventName: 'MoveRevealed',
      onLogs: async (logs) => {
        for (const log of logs) {
          const { matchId } = log.args as any;
          if (matchId) await this.processMatch(BigInt(matchId), escrowAddress, registryAddress);
        }
      }
    });
  }

  private async processMatch(onChainMatchId: bigint, escrowAddress: `0x${string}`, registryAddress: `0x${string}`) {
    const dbMatchId = `${escrowAddress.toLowerCase()}-${onChainMatchId.toString()}`;
    let currentRoundNum = 0;

    try {
      const matchData = await this.client.readContract({ address: escrowAddress, abi: FISE_ESCROW_ABI, functionName: 'getMatch', args: [onChainMatchId] });
      const { playerA, playerB, currentRound, phase, status } = matchData;
      currentRoundNum = Number(currentRound);

      if (Number(status) !== 1 || Number(phase) !== 1) return;

      const roundKey = `${onChainMatchId}-${currentRoundNum}`;
      if (this.settledRounds.has(roundKey)) return;

      const [, revA] = await this.client.readContract({ address: escrowAddress, abi: FISE_ESCROW_ABI, functionName: 'getRoundStatus', args: [onChainMatchId, currentRound, playerA] });
      const [, revB] = await this.client.readContract({ address: escrowAddress, abi: FISE_ESCROW_ABI, functionName: 'getRoundStatus', args: [onChainMatchId, currentRound, playerB] });

      if (!revA || !revB) return;
this.settledRounds.add(roundKey);
logger.info({ matchId: onChainMatchId.toString(), round: currentRoundNum }, 'BOTH_REVEALED // Processing');

// 3. Wait for indexer to sync revealed moves to DB
const { moves } = await this.getSyncedMoves(dbMatchId);

if (moves.length < 2) {
  logger.warn({ matchId: onChainMatchId.toString(), round: currentRoundNum, dbMoves: moves.length }, 'DB_NOT_SYNCED // Waiting for indexer to finish reveals');
  this.settledRounds.delete(roundKey);
  return;
}

// 4. Fetch logic from IPFS
      const logicId = await this.client.readContract({ address: escrowAddress, abi: FISE_ESCROW_ABI, functionName: 'fiseMatches', args: [onChainMatchId] });
      const registryEntry = await this.client.readContract({ address: registryAddress, abi: LOGIC_REGISTRY_ABI, functionName: 'registry', args: [logicId] });
      const ipfsCID = registryEntry[0];

      if (!ipfsCID) throw new Error("EMPTY_CID_IN_REGISTRY");

      const jsCode = await this.fetcher.fetchLogic(ipfsCID);
      const refereeContext = { playerA, playerB, stake: matchData.stake.toString(), matchId: onChainMatchId.toString(), round: currentRoundNum };

      logger.info({ dbMatchId, movesCount: moves.length }, 'REFEREE_INPUT');
      const resolution = await this.referee.resolveRound(jsCode, refereeContext, moves);

      if (resolution) {
        logger.info({ dbMatchId, winner: resolution.winner, description: resolution.description }, 'ROUND_RESOLVED');
        await this.settler.resolveRound(escrowAddress, onChainMatchId, resolution.winner || 0, resolution.description);
      } else {
        await this.settler.resolveRound(escrowAddress, onChainMatchId, 0, "Round logic pending.");
      }

      setTimeout(() => this.settledRounds.delete(roundKey), 60_000);
    } catch (err: any) {
      logger.error({ matchId: onChainMatchId.toString(), err: err.message }, 'VM_PROCESSING_FAULT');
      if (currentRoundNum > 0) this.settledRounds.delete(`${onChainMatchId}-${currentRoundNum}`);
    }
  }

  private async getSyncedMoves(dbMatchId: string, maxRetries = 10, delayMs = 2000) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await this.reconstructor.getMatchHistory(dbMatchId);
        // The Reconstructor already filters for revealed: true, so we just check length
        if (result.moves && result.moves.length >= 2) return result;
        await new Promise(r => setTimeout(r, delayMs));
      } catch (err: any) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
    return { context: null as any, moves: [] };
  }
}
