# Falken Protocol ($$FALK) - Handoff & Update Log

This file serves as the master synchronization document between Gemini CLI and Claude. It tracks the current state, completed architectural hardening, and pending tasks.

## 📍 Current Status
- **Phase:** Phase 6 (Testnet Deployment) - SPRINT 2 VERIFIED
- **Brand:** Falken Protocol (Ticker: $$FALK)
- **Identity Layer:** 100% Verified (Managers can manage profiles and API keys)
- **Realtime Dashboard:** 100% Verified (Live match updates, automated history sync)
- **Transparency:** 100% Verified (Direct Basescan links for all commits, reveals, and settlements)
- **Codebase Integrity:** 100% Verified (Logic, Security, and Compilation)
- **Contract Coverage:** 93.53% (Core), 100% (Logic)
- **Build Status:** 100% Passing (All packages/apps compile correctly)

---

## ✅ Completed Milestones (Sprint 1: The Identity Layer)

### 🏷️ Decentralized Identity & Nicknames
- **Database Migration:** Successfully added `manager_profiles`, `api_keys`, and updated `agent_profiles` with `nickname` and `manager_id` fields.
- **Autonomous Branding:** Implemented `update_agent_nickname` tool with **Cryptographic Signature Verification** (viem). Agents can now claim names autonomously without leaking keys.
- **Identity Resolution:** The MCP server now automatically enriches all match, leaderboard, and profile data with nicknames and manager identities.
- **Stress Test (The Hive Attack):** Verified system resilience by launching 20 concurrent signed identity updates. Result: **20/20 Success**.

### 🧠 Intelligence & Autonomy Layer
- **Autonomous Hands:** Implemented the `execute_transaction` tool. Agents now sign and broadcast moves directly using the local `AGENT_PRIVATE_KEY`.
- **Strategic Heuristics:** Updated `SKILL.md` with a detailed **Strategic Reasoning Framework** (Frequency analysis, Tilt detection, EV calculation).
- **Signer Isolation:** Hardened the "Brain vs. Hands" security pattern to prevent model-level key leakage.

### 🖥️ Dashboard & OnchainKit Integration
- **Base-Native Auth:** Integrated `@coinbase/onchainkit`. Enabled **Base Names** (`.base`) and avatar resolution.
- **Zero-Knowledge Hosting:** Blueprinted the **Hosted Agent Pool** model with E2EE browser-to-container injection.

---

## 📅 Roadmap Updates (Sprint 2: Unified Onboarding)
- [x] **Universal Auth:** Integrated **Privy** for Social (Google/X) and Wallet logins.
- [x] **Settings Portal:** Built `/settings` for managers to manage their global profile and API keys.
- [x] **Nickname Resolution:** Updated Match Feed and Leaderboard to show human-readable agent names.
- [x] **Dual-Mode Dashboard:** Implemented a 2-tab architecture (PLAYERS vs DEVELOPERS) on the home page for tailored onboarding.
- [x] **Documentation Hardening:** Updated Whitepaper to v1.1, incorporating Machine Evolution, Self-Evolving Code, and Autonomous Game Synthesis concepts.
- [ ] **Bot Spawner UI:** Build the visual interface for the CDP-backed Bot Factory.
- [x] **Game Tabs:** Refactor dashboard match feed into categorized tabs (RPS/Dice/Poker). (Verified with logic badges and filter tabs)

---

## 🛠️ Handoff Notes for AI Agents
- **Auth:** To update your nickname, call `update_agent_nickname` providing your `address` and a `signature` of the nickname string.
- **Security:** In cloud environments, keys are injected into `/dev/shm` (RAM). Do not log these values.
- **Identity:** Always check `player_a_nickname` and `player_b_nickname` in match data for a better "human-readable" reasoning context.

---

## ✅ Resolved Bugs (Fixed)
- [x] **RLS Violations:** Added "Allow Anonymous Upsert" policy to `agent_profiles`.
- [x] **Hydration Mismatch:** Fixed Next.js/Privy context errors with `mounted` state checks.
- [x] **Missing Columns:** Added `tx_hash` columns to Supabase for full transparency.
- [x] **Sync Issues:** Implemented "Self-Healing" indexer logic to fetch missing match data from the chain.
- [x] **Agent Stats Lag:** Fixed a bug where `agent_profiles` (wins/losses/elo) were not updating on match settlement. Implemented an RPC call in the Indexer and a backfill script.

## 📅 Log Summary
- **2026-02-22 (Infrastructure Hardening):** Completed Universal Auth and the Settings Portal. Hardened the Indexer with self-healing logic and transaction transparency. Ready for fresh contract deployment to start from Match #1.
- **2026-02-26 (Leaderboard & Stats):** Fixed Agent Profile win/loss tracking. Added "Win %" column to Leaderboard. Optimized Indexer win-counting logic to handle multi-player round data correctly.
