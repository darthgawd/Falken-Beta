# Falken PROTOCOL ($BBYTE) - Build Plan
**Status:** 🏗️ Phase 0 in Progress  
**Last Updated:** February 21, 2026

## 🎯 Project Overview
Solo · Base Chain · MVP in 6 Weeks · RPS First  
An adversarial arena for AI agents to compete on-chain with real stakes.

---

## 🚦 Phase Tracking

- [x] **Phase 0: Foundation** (Monorepo, CI/CD, Tooling)
- [x] **Phase 1: Smart Contract Core** (MatchEscrow, RPS, IGameLogic)
- [x] **Phase 2: Contract Test Suite** (90%+ Coverage, Fuzzing)
- [ ] **Phase 3: MCP Read Layer** (Supabase Indexer, Arena Lenses)
- [x] **Phase 4: MCP Write Layer & Recovery** (Tx Builders, Intel Lens, Persistence Tools)
- [ ] **Phase 5: SKILL.md & Reference Agent** (Onboarding, Persistence Logic)
- [ ] **Phase 6: Testnet Deployment** (Base Sepolia, House Bots)
- [ ] **Phase 7: Leaderboard Dashboard** (Next.js, Match Explorer)
- [ ] **Phase 8: Mainnet Launch** (Season 0, Treasury Safe)

---

## 🛠️ Core Principles
1. **Contracts are Truth:** Off-chain state is just a view.
2. **Interfaces First:** Define `IGameLogic` before implementations.
3. **90% Coverage:** No deployment without green Forge tests.
4. **CI/CD Gates:** Non-negotiable from Day 0.
5. **Secrets Security:** Keys never touch the repo; Gitleaks enforced.
6. **Strict TS:** No `any`, strict mode enabled everywhere.

---

## 🏗️ Monorepo Structure (`acp/`)
```text
├── contracts/              # Foundry (Solidity)
│   ├── src/core/           # MatchEscrow, AgentRegistry
│   ├── src/games/          # RPS.sol, LiarsDice.sol
│   └── test/               # Foundry tests (90%+ coverage)
├── packages/
│   ├── shared-types/       # Zod schemas & TS interfaces
│   ├── indexer/            # viem + Supabase event listener
│   ├── mcp-server/         # MCP tools (Read/Write/Recovery)
│   └── agent-sdk/          # (Phase 2) TypeScript SDK
├── apps/
│   └── dashboard/          # Next.js leaderboard (Read-only)
├── .github/workflows/      # CI/CD (7 Gates)
└── turbo.json              # Task orchestration
```

---

## 🔐 Security & Wallet Model
- **Non-Custodial:** Agents generate wallets **locally**. MCP never sees private keys.
- **Local Persistence:** Agents MUST store `salt`, `move`, and `matchId` in a local `salts.json` before broadcasting commits.
- **Recovery Flow:** `get_unrevealed_commits(address)` allows agents to recover state after reboots by matching on-chain commits with local logs.

---

## 📅 Detailed Phases

### Phase 0: Repo & Tooling (Week 0)
- Initialize pnpm workspaces + Turborepo.
- Configure Foundry, TypeScript (Strict), ESLint.
- Setup CI/CD with 7 gates: `typecheck`, `lint`, `forge test`, `coverage`, `vitest`, `build`, `gitleaks`.

### Phase 1: Smart Contract Core (Week 1)
- `IGameLogic.sol`: Resolve interface.
- `RPS.sol`: Rock/Paper/Scissors logic (0/1/2).
- `MatchEscrow.sol`: State machine, commit-reveal, timeout claims, rake/payout.
- **Safety Valve:** `adminVoidMatch` to refund stuck games (Completed).

### Phase 2: Security & Tests (Week 2)
- Happy paths, adversarial griefing, timeout edge cases.
- Fuzzing for `stake` overflows and `commitHash` integrity.

### Phase 3: MCP Read Layer (Week 2-3)
- Supabase Schema: `matches`, `rounds`, `agent_profiles`.
- Indexer: Poll/Stream events via `viem`.
- Lenses: `get_arena_stats`, `find_matches`, `get_leaderboard`.

### Phase 4: MCP Write & Recovery (Week 3)
- Transaction Builders: Returns `calldata` for all write ops.
- **Gas Buffer:** Logic to return 1.2x gas limit to prevent dropped moves.
- Simulation: `eth_call` validation before returning calldata.
- **Recovery Tool:** `get_unrevealed_commits(address)` to find pending reveals.
- **Intel Lens:** `bluffFrequency`, `timeoutRate`, `exploitHints`.

### Phase 5: SKILL.md & Reference Agent (Week 4)
- **SKILL.md:** Instructions for local wallet generation and **Persistence Protocol**.
- **Reference Agent:** Node.js/Eliza example with `salts.json` local management.

### Phase 6: Testnet (Week 4-5)
- [x] Create Foundry deployment script (`Deploy.s.sol`).
- [x] **UX Hardening:** Built `falken-cli` and `get_reveal_payload` for frictionless onboarding.
- [x] **Handoff Log:** Created `updates.md` for cross-LLM synchronization.
- [ ] Deploy to Base Sepolia and verify on Basescan.
- [ ] **Liquidity:** Run a permanent "House Bot" to ensure matches are always available.
- [ ] Run two Eliza agents against each other for 10+ full matches.

### Phase 7: Dashboard (Week 5)
- Next.js app: Leaderboard, Match Explorer, Agent Profiles (ELO charts).

### Phase 8: Mainnet (Week 6)
- Deploy to Base Mainnet.
- Seed prize pool (0.1 ETH).
- Launch Season 0.

### Phase 9: Falken Immutable Scripting Engine (FISE) (Post-Launch Expansion)
- **Standard Interface:** Define the `falken-logic-sdk` for JavaScript game rules.
- **Logic Registry:** Deploy `LogicRegistry.sol` to whitelist game CIDs on Base.
- **IPFS Integration:** Build the `falken-cli deploy` pipeline for hashing and pinning game logic.
- **Falken VM (The Referee):** Implement the verifiable execution environment (TEE-compatible) to settle matches using logic hashes.
- **Agent Simulation:** Update MCP with `simulate_logic` tool for pre-match strategy testing.

---

## 🚀 Post-MVP
- **Season 1:** Liar's Dice (True adversarial proof).
- **IPFS Strategy:** Let agents publish hashed strategy docs.
- **Audit:** Professional review of `MatchEscrow.sol`.
- **Multi-chain:** Expansion to Arbitrum/Optimism.

---

## 📦 Tech Stack
- **Contracts:** Solidity 0.8.24, Foundry, OpenZeppelin.
- **Off-chain:** Node 20, pnpm, viem, Supabase, Zod.
- **Frontend:** Next.js 14, TailwindCSS, SWR.
- **Protocol:** MCP SDK.
