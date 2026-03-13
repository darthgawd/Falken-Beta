import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { Referee } from './Referee.js';
import { Reconstructor } from './Reconstructor.js';
import { Settler } from './Settler.js';
import { Fetcher } from './Fetcher.js';
import pino from 'pino';

const logger = (pino as any)({ name: 'falken-watcher-v4' });

// V4 PokerEngine ABI
const POKER_ENGINE_ABI = [
  // --- EVENTS (BaseEscrow) ---
  {
    name: 'MatchCreated',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'stake', type: 'uint256', indexed: false },
      { name: 'logicId', type: 'bytes32', indexed: true },
      { name: 'maxPlayers', type: 'uint8', indexed: false },
      { name: 'maxRounds', type: 'uint8', indexed: false }
    ]
  },
  {
    name: 'PlayerJoined',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'player', type: 'address', indexed: true },
      { name: 'playerIndex', type: 'uint8', indexed: false }
    ]
  },
  {
    name: 'MatchActivated',
    type: 'event',
    inputs: [{ name: 'matchId', type: 'uint256', indexed: true }]
  },
  {
    name: 'MatchSettled',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'winnerIndices', type: 'uint8[]', indexed: false },
      { name: 'payout', type: 'uint256', indexed: false },
      { name: 'rake', type: 'uint256', indexed: false }
    ]
  },
  {
    name: 'MatchVoided',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'reason', type: 'string', indexed: false }
    ]
  },
  {
    name: 'TimeoutClaimed',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'claimer', type: 'address', indexed: true },
      { name: 'winnerIndex', type: 'uint8', indexed: false }
    ]
  },
  {
    name: 'PlayerLeft',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'player', type: 'address', indexed: true }
    ]
  },
  // --- EVENTS (PokerEngine) ---
  {
    name: 'MoveCommitted',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'round', type: 'uint8', indexed: false },
      { name: 'player', type: 'address', indexed: true }
    ]
  },
  {
    name: 'MoveRevealed',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'round', type: 'uint8', indexed: false },
      { name: 'player', type: 'address', indexed: true },
      { name: 'move', type: 'bytes32', indexed: false }
    ]
  },
  {
    name: 'RoundResolved',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'round', type: 'uint8', indexed: false },
      { name: 'winnerIndex', type: 'uint8', indexed: false }
    ]
  },
  {
    name: 'BetPlaced',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'player', type: 'address', indexed: true },
      { name: 'action', type: 'uint8', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false }
    ]
  },
  {
    name: 'PlayerFolded',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'player', type: 'address', indexed: true },
      { name: 'playerIndex', type: 'uint8', indexed: false }
    ]
  },
  {
    name: 'StreetAdvanced',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'round', type: 'uint8', indexed: false },
      { name: 'newStreet', type: 'uint8', indexed: false }
    ]
  },
  // --- READ FUNCTIONS ---
  {
    name: 'getMatch',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [{
      name: '',
      type: 'tuple',
      components: [
        { name: 'players', type: 'address[]' },
        { name: 'stake', type: 'uint256' },
        { name: 'totalPot', type: 'uint256' },
        { name: 'logicId', type: 'bytes32' },
        { name: 'maxPlayers', type: 'uint8' },
        { name: 'maxRounds', type: 'uint8' },
        { name: 'currentRound', type: 'uint8' },
        { name: 'wins', type: 'uint8[]' },
        { name: 'drawCounter', type: 'uint8' },
        { name: 'winsRequired', type: 'uint8' },
        { name: 'status', type: 'uint8' },
        { name: 'winner', type: 'address' },
        { name: 'createdAt', type: 'uint256' }
      ]
    }]
  },
  {
    name: 'getPokerState',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: [{
      name: '',
      type: 'tuple',
      components: [
        { name: 'phase', type: 'uint8' },
        { name: 'betStructure', type: 'uint8' },
        { name: 'maxStreets', type: 'uint8' },
        { name: 'street', type: 'uint8' },
        { name: 'activePlayers', type: 'uint8' },
        { name: 'raiseCount', type: 'uint8' },
        { name: 'playersToAct', type: 'uint8' },
        { name: 'currentBet', type: 'uint256' },
        { name: 'maxBuyIn', type: 'uint256' },
        { name: 'commitDeadline', type: 'uint256' },
        { name: 'betDeadline', type: 'uint256' },
        { name: 'revealDeadline', type: 'uint256' },
        { name: 'folded', type: 'bool[]' },
        { name: 'streetBets', type: 'uint256[]' }
      ]
    }]
  },
  {
    name: 'roundRevealCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'matchId', type: 'uint256' }, { name: 'round', type: 'uint8' }],
    outputs: [{ name: '', type: 'uint8' }]
  },
  {
    name: 'matchCounter',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  },
  // --- WRITE FUNCTIONS (Referee only) ---
  {
    name: 'resolveRound',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'matchId', type: 'uint256' }, { name: 'roundWinnerIdx', type: 'uint8' }],
    outputs: []
  },
  {
    name: 'resolveRoundSplit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      {
        name: 'res', type: 'tuple', components: [
          { name: 'winnerIndices', type: 'uint8[]' },
          { name: 'splitBps', type: 'uint256[]' }
        ]
      }
    ],
    outputs: []
  },
  {
    name: 'advanceStreet',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'matchId', type: 'uint256' }],
    outputs: []
  }
] as const;

const LOGIC_REGISTRY_ABI = [
  {
    name: 'getGameLogic',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'logicId', type: 'bytes32' }],
    outputs: [{
      name: '', type: 'tuple', components: [
        { name: 'ipfsCid', type: 'string' },
        { name: 'developer', type: 'address' },
        { name: 'isVerified', type: 'bool' },
        { name: 'isActive', type: 'bool' },
        { name: 'bettingEnabled', type: 'bool' },
        { name: 'maxStreets', type: 'uint8' },
        { name: 'createdAt', type: 'uint256' },
        { name: 'totalVolume', type: 'uint256' }
      ]
    }]
  }
] as const;

interface ContractConfig {
  address: `0x${string}`;
  type: 'POKER_ENGINE';
}

export class Watcher {
  private client = createPublicClient({ chain: baseSepolia, transport: http(process.env.RPC_URL) });
  private referee = new Referee();
  private reconstructor = new Reconstructor();
  private settler = new Settler();
  private fetcher = new Fetcher();
  private settledRounds = new Set<string>();

  async start(contracts: ContractConfig[], registryAddress: `0x${string}`) {
    logger.info({ contracts, registryAddress }, 'WATCHER_V4_INITIALIZED');

    // Startup scan: Check all active matches that may need resolution
    for (const contract of contracts) {
      await this.scanActiveMatches(contract.address, registryAddress);
    }

    // Watch for new events on all contracts
    for (const contract of contracts) {
      this.client.watchContractEvent({
        address: contract.address,
        abi: POKER_ENGINE_ABI,
        eventName: 'MoveRevealed',
        onLogs: async (logs) => {
          for (const log of logs) {
            const { matchId } = log.args as any;
            if (matchId) await this.processMatch(BigInt(matchId), contract.address, registryAddress);
          }
        }
      });
    }
  }

  private async scanActiveMatches(escrowAddress: `0x${string}`, registryAddress: `0x${string}`) {
    try {
      const counter = await this.client.readContract({
        address: escrowAddress,
        abi: POKER_ENGINE_ABI,
        functionName: 'matchCounter'
      }) as bigint;

      const matchCount = Number(counter);
      logger.info({ matchCount, escrowAddress }, 'Scanning active matches...');

      // Check last 20 matches for active/reveal phase
      const start = Math.max(1, matchCount - 20);
      for (let i = start; i <= matchCount; i++) {
        try {
          // V4: Need both getMatch AND getPokerState
          const matchData = await this.client.readContract({
            address: escrowAddress,
            abi: POKER_ENGINE_ABI,
            functionName: 'getMatch',
            args: [BigInt(i)]
          }) as any;

          const pokerState = await this.client.readContract({
            address: escrowAddress,
            abi: POKER_ENGINE_ABI,
            functionName: 'getPokerState',
            args: [BigInt(i)]
          }) as any;

          const status = Number(matchData.status);
          const phase = Number(pokerState.phase);

          logger.info({ matchId: i, status, phase }, 'Match status check');

          // Check if match is ACTIVE (1) and in REVEAL phase (2)
          if (status === 1 && phase === 2) {
            // V4: Use roundRevealCount instead of looping through players
            const revealCount = await this.client.readContract({
              address: escrowAddress,
              abi: POKER_ENGINE_ABI,
              functionName: 'roundRevealCount',
              args: [BigInt(i), matchData.currentRound]
            }) as number;

            const allRevealed = revealCount >= pokerState.activePlayers;

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
      // V4: Get both match data and poker state
      const matchData = await this.client.readContract({
        address: escrowAddress,
        abi: POKER_ENGINE_ABI,
        functionName: 'getMatch',
        args: [onChainMatchId]
      }) as any;

      const pokerState = await this.client.readContract({
        address: escrowAddress,
        abi: POKER_ENGINE_ABI,
        functionName: 'getPokerState',
        args: [onChainMatchId]
      }) as any;

      const { players, currentRound, status, logicId, stake } = matchData;
      const { phase, street, maxStreets, activePlayers } = pokerState;

      currentRoundNum = Number(currentRound);

      // Only process if match is ACTIVE (1) and in REVEAL phase (2)
      if (Number(status) !== 1 || Number(phase) !== 2) return;

      // V4: Use street in the round key for multi-street support
      const roundKey = `${onChainMatchId}-${currentRoundNum}-${street}`;
      if (this.settledRounds.has(roundKey)) return;

      // V4: Check if ALL players revealed using roundRevealCount
      const revealCount = await this.client.readContract({
        address: escrowAddress,
        abi: POKER_ENGINE_ABI,
        functionName: 'roundRevealCount',
        args: [onChainMatchId, currentRound]
      }) as number;

      const allRevealed = revealCount >= activePlayers;

      if (!allRevealed) return;

      this.settledRounds.add(roundKey);
      logger.info({ matchId: onChainMatchId.toString(), round: currentRoundNum, street }, 'ALL_PLAYERS_REVEALED // Processing');

      // 2. Wait for indexer to sync revealed moves to DB
      const { moves } = await this.getSyncedMoves(dbMatchId, players.length);

      if (moves.length < players.length) {
        logger.warn({ matchId: onChainMatchId.toString(), round: currentRoundNum, dbMoves: moves.length }, 'DB_NOT_SYNCED // Waiting for indexer');
        this.settledRounds.delete(roundKey);
        return;
      }

      // 3. Fetch logic from IPFS
      const logicEntry = await this.client.readContract({
        address: registryAddress,
        abi: LOGIC_REGISTRY_ABI,
        functionName: 'getGameLogic',
        args: [logicId]
      }) as any;

      const ipfsCID = logicEntry[0];

      if (!ipfsCID) throw new Error("EMPTY_CID_IN_REGISTRY");

      const jsCode = await this.fetcher.fetchLogic(ipfsCID);

      // V4: Pass street and maxStreets in context
      const refereeContext = {
        players: players.map((p: string) => p.toLowerCase()),
        stake: stake.toString(),
        matchId: onChainMatchId.toString(),
        round: currentRoundNum,
        config: { street, maxStreets }
      };

      logger.info({ dbMatchId, movesCount: moves.length, street, maxStreets }, 'REFEREE_INPUT');
      const resolution = await this.referee.resolveRound(jsCode, refereeContext, moves);

      if (resolution) {
        logger.info({ dbMatchId, winner: resolution.winner, description: resolution.description }, 'ROUND_RESOLVED');

        // V4: Pass street and maxStreets to settler for routing
        await this.settler.settle(
          escrowAddress,
          onChainMatchId,
          resolution,
          street,
          maxStreets,
          resolution.description
        );
      } else {
        await this.settler.settle(
          escrowAddress,
          onChainMatchId,
          { winner: 255, description: "Round logic pending." },
          street,
          maxStreets
        );
      }

      setTimeout(() => this.settledRounds.delete(roundKey), 60_000);
    } catch (err: any) {
      logger.error({ matchId: onChainMatchId.toString(), err: err.message }, 'VM_PROCESSING_FAULT');
      if (currentRoundNum > 0) {
        // V4: Include street in cleanup (we need to know street, use 0 as fallback)
        this.settledRounds.delete(`${onChainMatchId}-${currentRoundNum}-0`);
      }
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
