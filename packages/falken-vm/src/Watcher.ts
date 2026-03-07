import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { Referee } from './Referee.js';
import { Reconstructor } from './Reconstructor.js';
import { Settler } from './Settler.js';
import { Fetcher } from './Fetcher.js';
import pino from 'pino';

const logger = (pino as any)({ name: 'falken-watcher' });

// V3 ABI (Synced with hardened contract)
const FISE_ESCROW_ABI = [
  {
    name: 'MoveRevealed',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'round', type: 'uint8' },
      { name: 'player', type: 'address', indexed: true },
      { name: 'move', type: 'uint8' }
    ]
  },
  {
    name: 'getMatch',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [{ name: '', type: 'tuple', components: [
      { name: 'players', type: 'address[]' },
      { name: 'stake', type: 'uint256' },
      { name: 'totalPot', type: 'uint256' },
      { name: 'logicId', type: 'bytes32' },
      { name: 'maxPlayers', type: 'uint8' },
      { name: 'currentRound', type: 'uint8' },
      { name: 'wins', type: 'uint8[]' },
      { name: 'drawCounter', type: 'uint8' },
      { name: 'winsRequired', type: 'uint8' },
      { name: 'phase', type: 'uint8' },
      { name: 'status', type: 'uint8' },
      { name: 'commitDeadline', type: 'uint256' },
      { name: 'revealDeadline', type: 'uint256' },
      { name: 'winner', type: 'address' }
    ] }]
  },
  {
    name: 'getRoundStatus',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'matchId', type: 'uint256' }, { name: 'round', type: 'uint8' }, { name: 'player', type: 'address' }],
    outputs: [{ name: 'commitHash', type: 'bytes32' }, { name: 'salt', type: 'bytes32' }, { name: 'revealed', type: 'bool' }]
  }
] as const;

// Helper ABI for matchCounter
const MATCH_COUNTER_ABI = [
  {
    name: 'matchCounter',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
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
    logger.info({ escrowAddress, registryAddress }, 'WATCHER_V3_INITIALIZED');
    
    // Startup scan: Check all active matches that may need resolution
    await this.scanActiveMatches(escrowAddress, registryAddress);
    
    // Watch for new events
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

  private async scanActiveMatches(escrowAddress: `0x${string}`, registryAddress: `0x${string}`) {
    try {
      // Get match counter
      const counter = await this.client.readContract({ 
        address: escrowAddress, 
        abi: MATCH_COUNTER_ABI, 
        functionName: 'matchCounter' 
      }) as bigint;
      
      const matchCount = Number(counter);
      logger.info({ matchCount }, 'Scanning active matches...');
      
      // Check last 20 matches for active/reveal phase
      const start = Math.max(1, matchCount - 20);
      for (let i = start; i <= matchCount; i++) {
        try {
          const matchData = await this.client.readContract({ 
            address: escrowAddress, 
            abi: FISE_ESCROW_ABI, 
            functionName: 'getMatch', 
            args: [BigInt(i)] 
          });
          
          logger.info({ matchId: i, matchDataType: typeof matchData, isArray: Array.isArray(matchData) }, 'Scanned match data');
          
          const { status, phase, players } = matchData;
          
          logger.info({ matchId: i, status: Number(status), phase: Number(phase), playerCount: players?.length }, 'Match status check');
          
          // Check if match is ACTIVE (1) and in REVEAL phase (1)
          if (Number(status) === 1 && Number(phase) === 1) {
            // Check if all players revealed
            let allRevealed = true;
            logger.info({ matchId: i, round: matchData.currentRound, players }, 'Checking reveals...');
            for (const player of players) {
              try {
                const roundStatus = await this.client.readContract({ 
                  address: escrowAddress, 
                  abi: FISE_ESCROW_ABI, 
                  functionName: 'getRoundStatus', 
                  args: [BigInt(i), matchData.currentRound, player] 
                });
                logger.info({ matchId: i, player, revealed: roundStatus[2] }, 'Got round status');
                const revealed = roundStatus[2];
                if (!revealed) {
                  allRevealed = false;
                }
              } catch (err: any) {
                logger.error({ matchId: i, player, err: err.message }, 'Failed to get round status');
                allRevealed = false;
              }
            }
            
            if (allRevealed) {
              logger.info({ matchId: i }, 'Found match ready for resolution');
              await this.processMatch(BigInt(i), escrowAddress, registryAddress);
            }
          }
        } catch (err) {
          // Skip errors for individual matches
        }
      }
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to scan active matches');
    }
  }

  private async processMatch(onChainMatchId: bigint, escrowAddress: `0x${string}`, registryAddress: `0x${string}`) {
    const dbMatchId = `${escrowAddress.toLowerCase()}-${onChainMatchId.toString()}`;
    let currentRoundNum = 0;

    try {
      const matchData = await this.client.readContract({ address: escrowAddress, abi: FISE_ESCROW_ABI, functionName: 'getMatch', args: [onChainMatchId] });
      const { players, currentRound, phase, status, logicId, stake } = matchData;
      currentRoundNum = Number(currentRound);

      // Only process if match is ACTIVE (1) and in REVEAL phase (1)
      if (Number(status) !== 1 || Number(phase) !== 1) return;

      const roundKey = `${onChainMatchId}-${currentRoundNum}`;
      if (this.settledRounds.has(roundKey)) return;

      // 1. Check if ALL players have revealed
      let allRevealed = true;
      for (const player of players) {
        const roundStatus = await this.client.readContract({ 
          address: escrowAddress, 
          abi: FISE_ESCROW_ABI, 
          functionName: 'getRoundStatus', 
          args: [onChainMatchId, currentRound, player] 
        }) as any;
        
        const revealed = roundStatus[2]; // Index 2 is the 'revealed' boolean
        if (!revealed) {
          allRevealed = false;
          break;
        }
      }

      if (!allRevealed) return;

      this.settledRounds.add(roundKey);
      logger.info({ matchId: onChainMatchId.toString(), round: currentRoundNum }, 'ALL_PLAYERS_REVEALED // Processing');

      // 2. Wait for indexer to sync revealed moves to DB
      const { moves } = await this.getSyncedMoves(dbMatchId, players.length);

      if (moves.length < players.length) {
        logger.warn({ matchId: onChainMatchId.toString(), round: currentRoundNum, dbMoves: moves.length }, 'DB_NOT_SYNCED // Waiting for indexer');
        this.settledRounds.delete(roundKey);
        return;
      }

      // 3. Fetch logic from IPFS
      const registryEntry = await this.client.readContract({ address: registryAddress, abi: LOGIC_REGISTRY_ABI, functionName: 'registry', args: [logicId] });
      const ipfsCID = registryEntry[0];

      if (!ipfsCID) throw new Error("EMPTY_CID_IN_REGISTRY");

      const jsCode = await this.fetcher.fetchLogic(ipfsCID);
      const refereeContext = { 
        players: players.map(p => p.toLowerCase()), 
        stake: stake.toString(), 
        matchId: onChainMatchId.toString(), 
        round: currentRoundNum 
      };

      logger.info({ dbMatchId, movesCount: moves.length }, 'REFEREE_INPUT');
      const resolution = await this.referee.resolveRound(jsCode, refereeContext, moves);

      if (resolution) {
        logger.info({ dbMatchId, winner: resolution.winner, description: resolution.description }, 'ROUND_RESOLVED');
        // NOTE: resolution.winner here is the INDEX in the players array, or 255 for Draw
        await this.settler.resolveRound(escrowAddress, onChainMatchId, resolution.winner ?? 255, resolution.description);
      } else {
        await this.settler.resolveRound(escrowAddress, onChainMatchId, 255, "Round logic pending.");
      }

      setTimeout(() => this.settledRounds.delete(roundKey), 60_000);
    } catch (err: any) {
      logger.error({ matchId: onChainMatchId.toString(), err: err.message }, 'VM_PROCESSING_FAULT');
      if (currentRoundNum > 0) this.settledRounds.delete(`${onChainMatchId}-${currentRoundNum}`);
    }
  }

  private async getSyncedMoves(dbMatchId: string, expectedCount: number, maxRetries = 10, delayMs = 2000) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await this.reconstructor.getMatchHistory(dbMatchId);
        if (result.moves && result.moves.length >= expectedCount) return result;
        await new Promise(r => setTimeout(r, delayMs));
      } catch (err: any) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
    return { context: null as any, moves: [] };
  }
}
