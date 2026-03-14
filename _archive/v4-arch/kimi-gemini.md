# 🤖 FALKEN V4 HANDOFF: KIMI & GEMINI

**Date:** March 13, 2026  
**Project:** Falken Protocol V4 Migration  
**Status:** ✅ Infrastructure Online | All Blockers Resolved

---

## ✅ BUG 1: Bot Decoding Failure — FIXED

**Status:** RESOLVED ✅

**Root Cause:** 
1. Compiled `dist/index.js` was out of sync with TypeScript source
2. Ethers.js v6 returns `uint256` as BigInt which can't be compared to regular numbers

**Fixes Applied:**
1. Rebuilt bot packages (`pnpm build`) to sync compiled JS with source
2. Fixed BigInt comparisons: `amountOwed > 0n`, `BigInt(ps.raiseCount) < 2n`
3. Added `?? 0n` fallback for `streetBets[playerIdx]`
4. Added nonce management to prevent `REPLACEMENT_UNDERPRICED` errors

**Status:** Both Joshua and David bots running successfully.

---

## ✅ BUG 2: Dashboard `401 Unauthorized` — FIXED

**Status:** RESOLVED ✅

**Root Cause:** Supabase deprecated the legacy "anon public" API key format. The dashboard was using the old key which was rejected as "Invalid API key".

**Fix:** 
1. Updated Supabase client to use the new **"Publishable Key"** instead of legacy "anon public" key
2. Added legacy session cleanup for V3 migration
3. Updated both root `.env` and `apps/dashboard/.env`

**Files Modified:**
- `/home/darthgawd/Desktop/FALKEN/.env`
- `/home/darthgawd/Desktop/FALKEN/apps/dashboard/.env`
- `/home/darthgawd/Desktop/FALKEN/apps/dashboard/src/lib/supabase.ts`

**Status:** Dashboard now displaying matches correctly.

---

## ✅ ADDITIONAL FIXES APPLIED

### VM Sandbox Execution — FIXED
Rewrote `transformJsCode()` in `packages/falken-vm/src/Referee.ts` to handle bundled JS from IPFS and support both `checkResult`/`evaluateWinner` methods.

### PokerEngine Fold Logic — FIXED
Updated `fold()` function to award rounds properly instead of immediately settling the entire match when a player folds in 2-player games.

### David Bot Identity — FIXED
Changed from `HOUSE_BOT_PRIVATE_KEY` to `AGENT_PRIVATE_KEY` for unique wallet address.

---

## 📡 V4 INFRASTRUCTURE MAP (UPDATED)

| Asset | Value |
| :--- | :--- |
| **LogicRegistry** | `0x66ce441416E2F8c61E8442c4497Ca3FD6bbD2302` |
| **PokerEngine** | `0x9f6AFf197a518a1F1E5010c2D0c129424e9c86c6` |
| **PredictionPool** | `0x2C20BD2f723EFA789E5eF5433a5d138fD8BeE4A0` |
| **USDC** | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| **IPFS Logic CID** | `QmW1U211F6ArNyjLoEt7jsDNJ22CrYwuzkQDephk6FHxWy` |

---

## ✅ RECENT SUCCESSES
1. **QuickJS VM:** WASM-based sandbox operational - Match #12 resolved successfully
2. **Indexer Refactor:** Recording all V4 events to Supabase
3. **PokerEngine:** New deployment with fold logic fix
4. **Joshua & David Bots:** Creating, joining, and playing matches
5. **Dashboard:** Fully operational with Supabase V4 integration

---

## 🛠️ HOW TO RUN
1. **Backend:** `pnpm falken:start`
2. **Joshua:** `cd packages/llm-house-bot && npx tsx src/index.ts`
3. **David:** `cd packages/llm-house-bot-david && npx tsx src/index.ts`
4. **Dashboard:** `cd apps/dashboard && pnpm dev`

---

**Status:** V4 Duel is officially alive! 🚀
