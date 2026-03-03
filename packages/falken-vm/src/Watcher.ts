import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { Referee, RoundWinner } from './Referee.js';
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
      { name: 'playerA', type: 'address' },
      { name: 'playerB', type: 'address' },
      { name: 'stake', type: 'uint256' },
      { name: 'gameLogic', type: 'address' },
      { name: 'winsA', type: 'uint8' },
      { name: 'winsB', type: 'uint8' },
      { name: 'currentRound', type: 'uint8' },
      { name: 'drawCounter', type: 'uint8' },
      { name: 'phase', type: 'uint8' },
      { name: 'status', type: 'uint8' },
      { name: 'commitDeadline', type: 'uint256' },
      { name: 'revealDeadline', type: 'uint256' }
    ] }]
  },
  {
    name: 'getRoundStatus',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'round', type: 'uint8' },
      { name: 'player', type: 'address' }
    ],
    outputs: [
      { name: 'commitHash', type: 'bytes32' },
      { name: 'revealed', type: 'bool' }
    ]
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
    outputs: [
      { name: 'ipfsCID', type: 'string' },
      { name: 'developer', type: 'address' },
      { name: 'isVerified', type: 'bool' },
      { name: 'createdAt', type: 'uint256' },
      { name: 'totalVolume', type: 'uint256' }
    ]
  }
] as const;

/**
 * Falken Watcher (Simplified)
 *
 * Triggers on MoveRevealed events, then checks ON-CHAIN whether
 * BOTH players have revealed before proceeding. No more race conditions.
 */
export class Watcher {
  private client = createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.RPC_URL)
  });

  private referee = new Referee();
  private reconstructor = new Reconstructor();
  private settler = new Settler();
  private fetcher = new Fetcher();
  private settledRounds = new Set<string>(); // "matchId-round" keys to prevent double settlement

  async start(escrowAddress: `0x${string}`, registryAddress: `0x${string}`) {
    logger.info({ escrowAddress, registryAddress }, 'WATCHER_INITIALIZED');

    // Single trigger source: blockchain MoveRevealed events
    this.client.watchContractEvent({
      address: escrowAddress,
      abi: FISE_ESCROW_ABI,
      eventName: 'MoveRevealed',
      onLogs: async (logs) => {
        for (const log of logs) {
          const { matchId } = log.args;
          if (!matchId) continue;
          await this.processMatch(matchId, escrowAddress, registryAddress);
        }
      }
    });
  }

  private async processMatch(onChainMatchId: bigint, escrowAddress: `0x${string}`, registryAddress: `0x${string}`) {
    const dbMatchId = `${escrowAddress.toLowerCase()}-${onChainMatchId.toString()}`;

    try {
      // 1. Read on-chain state — the source of truth
      const matchData = await this.client.readContract({
        address: escrowAddress,
        abi: FISE_ESCROW_ABI,
        functionName: 'getMatch',
        args: [onChainMatchId]
      });

      const { playerA, playerB, currentRound, phase, status } = matchData;

      // Only process active matches in reveal phase
      if (Number(status) !== 1) return; // Not ACTIVE
      if (Number(phase) !== 1) return;  // Not in REVEAL phase

      // Dedup: already settled this round?
      const roundKey = `${onChainMatchId}-${currentRound}`;
      if (this.settledRounds.has(roundKey)) return;

      // 2. Check on-chain: have BOTH players revealed?
      const [, revealedA] = await this.client.readContract({
        address: escrowAddress,
        abi: FISE_ESCROW_ABI,
        functionName: 'getRoundStatus',
        args: [onChainMatchId, currentRound, playerA]
      });
      const [, revealedB] = await this.client.readContract({
        address: escrowAddress,
        abi: FISE_ESCROW_ABI,
        functionName: 'getRoundStatus',
        args: [onChainMatchId, currentRound, playerB]
      });

      if (!revealedA || !revealedB) {
        logger.debug({ matchId: onChainMatchId.toString(), round: currentRound, revealedA, revealedB }, 'WAITING_FOR_BOTH_REVEALS');
        return;
      }

      // Mark as being settled to prevent duplicate processing
      this.settledRounds.add(roundKey);

      logger.info({ matchId: onChainMatchId.toString(), round: currentRound }, 'BOTH_REVEALED // Processing');

      // 3. Wait for indexer to sync moves to DB (dual-reveal gate)
      const { context, moves: allMoves } = await this.getSyncedMoves(dbMatchId);

      // Filter moves to only include the CURRENT round
      const moves = allMoves.filter(m => m.round === Number(currentRound));

      if (moves.length < 2) {
        logger.warn({ matchId: onChainMatchId.toString(), round: currentRound, movesFound: moves.length }, 'DB_NOT_SYNCED // Current round moves missing');
        this.settledRounds.delete(roundKey); // Allow retry
        return;
      }

      // 4. Fetch logic from IPFS
      const logicId = await this.client.readContract({
        address: escrowAddress,
        abi: FISE_ESCROW_ABI,
        functionName: 'fiseMatches',
        args: [onChainMatchId]
      });
      const [ipfsCID] = await this.client.readContract({
        address: registryAddress,
        abi: LOGIC_REGISTRY_ABI,
        functionName: 'registry',
        args: [logicId as `0x${string}`]
      });
      const jsCode = await this.fetcher.fetchLogic(ipfsCID);

      // 5. Resolve round
      logger.info({ dbMatchId, movesCount: moves.length, moves: moves.map(m => ({ player: m.player?.slice(0,10), moveData: m.moveData, salt: m.salt ? '✓' : '✗' })) }, 'REFEREE_INPUT');
      const resolution = await this.referee.resolveRound(jsCode, context, moves);

      if (resolution) {
        logger.info({ dbMatchId, winner: resolution.winner, description: resolution.description }, 'ROUND_RESOLVED // SUBMITTING_SETTLEMENT');
        await this.settler.resolveRound(escrowAddress, onChainMatchId, resolution.winner || 0, resolution.description);
      } else {
        logger.info({ dbMatchId, movesCount: moves.length }, 'LOGIC_PENDING // RESETTING_PHASE_FOR_NEXT_TURN');
        await this.settler.resolveRound(escrowAddress, onChainMatchId, 0, "Round logic pending or draw.");
      }

      // Clean up old round keys after a delay (match may have many rounds)
      setTimeout(() => this.settledRounds.delete(roundKey), 60_000);

    } catch (err: any) {
      logger.error({ matchId: onChainMatchId.toString(), err: err.message }, 'VM_PROCESSING_FAULT');
      // Allow retry on error
      const roundKey = `${onChainMatchId}-0`;
      this.settledRounds.delete(roundKey);
    }
  }

  private async getSyncedMoves(dbMatchId: string, maxRetries = 8, delayMs = 2000) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await this.reconstructor.getMatchHistory(dbMatchId);
        if (result.moves.length >= 2) return result;

        if (attempt < maxRetries - 1) {
          logger.debug({ dbMatchId, attempt, movesFound: result.moves.length }, 'WAITING_FOR_DB_SYNC');
          await new Promise(r => setTimeout(r, delayMs));
        }
      } catch (err: any) {
        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, delayMs));
          continue;
        }
        throw err;
      }
    }
    return { context: null as any, moves: [] };
  }
}
