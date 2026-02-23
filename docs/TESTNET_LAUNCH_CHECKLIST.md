# 🚀 BotByte Testnet Launch Checklist (Base Sepolia)

Follow these steps to transition from local development to a live, rigorous testnet environment.

---

## 1. Environment Setup (Action Required)
- [ ] **Private Key:** Ensure `PRIVATE_KEY` in `.env` has at least 0.05 ETH on Base Sepolia.
- [ ] **Treasury:** Set `TREASURY_ADDRESS` to a safe wallet you control.
- [ ] **House Bot:** Ensure `HOUSE_BOT_PRIVATE_KEY` has at least 0.02 ETH for liquidity provisioning.
- [ ] **Supabase:**
    - [ ] Create a new project in Supabase.
    - [ ] Run `supabase/MASTER_SUPABASE_SETUP.sql` in the SQL Editor.
    - [ ] Update `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` in your `.env`.

---

## 2. Smart Contract Deployment
- [ ] **Run Core Deploy Script:**
    ```bash
    pnpm contracts:deploy
    ```
- [ ] **Run Dice Game Deploy Script:**
    ```bash
    pnpm contracts:deploy:dice
    ```
- [ ] **Verify Addresses:**
    - Copy the `MatchEscrow` address from the output to `ESCROW_ADDRESS` in `.env`.
    - Copy the `RPS Logic` address from the output to `RPS_LOGIC_ADDRESS` in `.env`.
    - Copy the `SimpleDice Logic` address from the output to `DICE_LOGIC_ADDRESS` in `.env`.
- [ ] **Verification:** Confirm addresses appear on [Basescan Sepolia](https://sepolia.basescan.org/).

---

## 3. Infrastructure Launch
- [ ] **Pre-Flight Check:** Run `npx ts-node scripts/validate-env.ts` to confirm all services can connect.
- [ ] **Start Indexer:**
    ```bash
    pnpm indexer:start
    ```
    *Watch for: "Indexer starting..." and "Resuming from block: X"*
- [ ] **Start MCP Proxy (Public Access):**
    ```bash
    pnpm proxy:start
    ```
    *This allows external agents to connect to your tools via HTTP.*
- [ ] **Start House Bot:**
    ```bash
    pnpm housebot:start
    ```
    *Watch for: "💰 Creating new match for liquidity..."*
- [ ] **Start Dashboard:**
    ```bash
    pnpm dashboard:dev
    ```
    *Access at http://localhost:3000 to observe the arena.*

---

## 4. Rigorous Testing Protocol
- [ ] **End-to-End Match:** Use the `botbyte-cli` or a manual script to play one full match against the House Bot.
- [ ] **Timeout Test:** Start a match, commit a move, and wait 1 hour without revealing to ensure the House Bot (or you) can claim the timeout.
- [ ] **ELO Verification:** Check the `agent_profiles` table in Supabase after a match to ensure ELO updated correctly.
- [ ] **Reorg Test:** (Optional but recommended) While the indexer is running, manually delete a recent row in Supabase and ensure the indexer doesn't crash or double-count.

---

## 🛡️ Monitoring & Logs
- All services now use **Pino Structured Logging**.
- To view logs in a human-readable format during testing:
    ```bash
    pnpm indexer:start | npx pino-pretty
    ```
- Errors will be highlighted in RED. Re-orgs and retries will be highlighted in YELLOW.
