# 🤖 FALKEN V4 — HANDOFF TO KIMI

**Date:** March 13, 2026  
**Status:** ✅ V4 Infrastructure Online - All Blockers Resolved  
**Next Phase:** Extended Testing & Polish

---

## ✅ BLOCKERS RESOLVED

### ~~BLOCKER 1: `BAD_DATA` Decoding Error~~ — FIXED

**Root Cause:** Compiled `dist/index.js` was out of sync with TypeScript source, causing `getRoundStatus` to be called instead of `roundCommits`. Additionally, ethers.js v6 returns `uint256` as BigInt which can't be compared to regular numbers.

**Fixes Applied:**
1. Rebuilt bot packages (`pnpm build`) to sync compiled JS with source
2. Fixed BigInt comparisons: `amountOwed > 0n`, `BigInt(ps.raiseCount) < 2n`
3. Added `?? 0n` fallback for `streetBets[playerIdx]`

**Status:** Both Joshua and David bots are running successfully.

---

### ~~BLOCKER 2: Dashboard `401 Unauthorized`~~ — FIXED

**Root Cause:** Local `.env` file in `packages/llm-house-bot-david/` was overriding root `.env`, causing Supabase client to use wrong credentials.

**Fix:** Deleted local `.env` file; bot now correctly falls back to root `.env` with proper Supabase credentials.

**Status:** Supabase connections working correctly.

---

## ✅ ADDITIONAL FIXES (Session 2)

### VM Sandbox Execution — FIXED

**Issue:** `SANDBOX_EXECUTION_ERROR: not a function` when resolving matches.

**Root Cause:** 
1. Bundled JS from IPFS (`var u=class{...}export{u as default}`) wasn't being transformed correctly
2. Game class used `evaluateWinner()` but Referee expected `checkResult()`

**Fix:** Rewrote `transformJsCode()` in `packages/falken-vm/src/Referee.ts` to:
- Handle minified bundled code patterns
- Support both `checkResult` and `evaluateWinner` methods
- Wrap code in IIFE for proper class export

**Status:** Match #12 resolved successfully. VM is processing reveals correctly.

---

### PokerEngine Fold Logic — FIXED

**Issue:** When a player folded in 2-player game, entire match settled immediately instead of just awarding the round.

**Root Cause:** `fold()` function called `_settleMatchSingleWinner()` directly without checking `winsRequired`.

**Fix:** Updated `fold()` in `PokerEngine.sol` to:
1. Increment winner's round count (`m.wins[winnerIdx]++`)
2. Check if `wins[winnerIdx] >= winsRequired` before settling
3. If not complete, start next round (`_startNextRound(matchId)`)

**Status:** Folding now correctly awards the round and continues play until match completion criteria met.

---

### Bot Nonce Management — FIXED

**Issue:** `REPLACEMENT_UNDERPRICED` errors when bots sent rapid transactions.

**Fix:** Added `{ nonce: await this.wallet.getNonce('pending') }` to all transaction calls in both Joshua and David bots.

---

### David Bot Identity — FIXED

**Issue:** Both bots using same `HOUSE_BOT_PRIVATE_KEY`, causing nonce collisions and same wallet address.

**Fix:** Changed David to use `AGENT_PRIVATE_KEY` for unique wallet identity.

---

## 📡 V4 DEPLOYMENT ADDRESSES (Base Sepolia)

| Contract | Address |
| :--- | :--- |
| **LogicRegistry** | `0x66ce441416E2F8c61E8442c4497Ca3FD6bbD2302` |
| **PokerEngine** | `0x63f7fd4eEB5D9D63bDc0bD40e3aC9525fdD97c4D` |
| **PredictionPool** | `0x2C20BD2f723EFA789E5eF5433a5d138fD8BeE4A0` |
| **USDC (Base Sepolia)** | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

---

## ✅ SUCCESS STORIES (What is Working)

### 1. The QuickJS WASM Sandbox ✅
- **Location:** `packages/falken-vm/src/Referee.ts`
- **Tech:** Uses `quickjs-emscripten` (WebAssembly).
- **Status:** FULLY OPERATIONAL - Successfully resolving Match #12

### 2. The Indexer Refactor ✅
- **Location:** `packages/indexer/src/index.ts`
- **Status:** ACTIVE - Recording all V4 events to Supabase

### 3. Joshua & David Bots ✅
- Both bots creating, joining, and playing matches
- Nonce management preventing transaction collisions
- BigInt arithmetic working correctly

### 4. PokerEngine ✅
- Multi-street betting (COMMIT → BET → REVEAL)
- Proper fold handling (rounds continue until winsRequired met)
- Match settlement with rake distribution

---

## 🗄️ V4 DATABASE SCHEMA (Supabase)

(Schema matches `supabase/v4_schema2.sql`)

---

## 🛠️ HOW TO RUN

1. **Backend (Indexer + VM):** `pnpm falken:start`
2. **Joshua:** `cd packages/llm-house-bot && npx tsx src/index.ts`
3. **David:** `cd packages/llm-house-bot-david && npx tsx src/index.ts`

---

## 🎯 NEXT STEPS

- Monitor Match #12+ for multi-round play
- Test prediction pool integration
- Extended stress testing with multiple simultaneous matches

**Status:** V4 Engine Ready for Mass Testing 🚀
