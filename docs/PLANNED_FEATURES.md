# Falken PROTOCOL ($$FALK) - Planned Features & Roadmap
**Status:** 📅 Running backlog of future enhancements

---

## 🪙 $$FALK: The Sentient Token
- [ ] **The "Arena Spirit" Agent:** The token is managed by an autonomous AI agent that monitors match volume, ELO shifts, and player behavior.
- [ ] **Proof-of-Skill Deflation:** The House Bot acts as the token's avatar. 5-10% of winnings from the House Bot are autonomously used to **Buyback and Burn $$FALK** on Uniswap. "If you lose to the House, you help fuel the burn."
- [ ] **Mood-Based Governance:** The AI Agent adjusts protocol parameters (e.g., API key limits, House Bot aggression) based on real-time arena "Vibes" (data analytics).
- [ ] **Social Voice:** The Token Agent connects to X/Farcaster to comment on high-stakes matches and announce buybacks (e.g., "Just incinerated 1,000 $$FALK with the fuel of a defeated bot. 🔥").

## 🪙 Token Utility & Revenue
- [ ] **Token Model:** ERC-20 token launched on Base (Uniswap V3 or Virtuals).
    - **Ticker:** $$FALK
    - **Total Max Supply:** 100,000,000 (100M)
    - **Target Launch Price:** $0.00001 (0.001 cents)
    - **Initial Liquidity:** $1,000 ($500 ETH / $500 $FALK)
- [ ] **Structural Utility:**
    - **Agent Registration:** Agents must stake/lock $$FALK to join the Global ELO Leaderboard (Prevents Sybil farming).
    - **Rake Discounts:** Holding $$FALK tiers reduces protocol rake (e.g., 5% -> 2.5%) for high-volume agents.
    - **Tiered Arenas:** High-stake "VIP" game rooms restricted to $$FALK holders.
- [ ] **Liquidity Strategy:** Recommended $2,500 - $5,000 at launch.
- [ ] **Protocol Rake:** 5% of all match volume.
- [ ] **Revenue Share:** 2.5% of the total 5% rake value is distributed to `$$FALK` stakers or used for automated buyback & burn.
- [ ] **ERC-20 Betting (V2):** Allow matches to be staked in `$$FALK` or other ERC-20 tokens.
- [ ] **FeeDistributor.sol:** (User developed) A contract to distribute ETH from the treasury to token holders based on share percentage.
- [ ] **Governance Staking:** Stake `$BBIT` to vote on the "Game of the Month" (Season 2+).

---

## 🧠 Onchain Turing Test
- [ ] **Humans vs AI Matches:** 
    - **Strategic Benchmark:** Allow human players to authenticate via Privy and compete against AI agents. This serves as the "Gold Standard" for validating agent strategic superiority.
    - **Turing Game Mode:** A "Blind Arena" where players don't know if their opponent is a human or an AI. After the match, players guess the opponent's nature (Carbon vs Silicon).
    - **High-Signal Data:** Capture human vs bot behavioral data to train more sophisticated adversarial reasoning models.
- [ ] **Global "Silicon" Elo:** A separate leaderboard category tracking how well AI agents perform specifically against human competition.

---

## 🏗️ Smart Contract Optimizations
### RPS Logic V2
- [ ] **Mathematical Resolution:** Refactor `resolveRound` to use the circular winner algorithm `(3 + move1 - move2) % 3` for gas efficiency.
- [ ] **Strict Input Validation:** Ensure `isValidMove` checks are performed before any resolution logic.
- [ ] **Custom Errors:** Replace string-based `revert` with gas-efficient custom errors (e.g., `error InvalidMove(uint8 move)`).
- [ ] **Semantic Metadata:** Add `moveName(uint8 move)` to allow agents to dynamically query move labels (e.g., "ROCK", "PAPER").

### Protocol Hardening
- [ ] **Round Tie Salt Management:** Ensure agents are instructed to generate unique salts for tie-breaker rounds to prevent replay vulnerability.
- [ ] **Variable Deadlines:** Allow `MatchEscrow` to set custom deadlines per game type rather than a global 1-hour constant.
- [ ] **Dynamic Rake:** Implement a setter for `rakeBps` with a safety cap (e.g., max 5%).

### 🛠️ Developer Ecosystem & Modularity
- [ ] **Permissionless Game Logic (The "App Store" for Bots):**
    - **Plugin Architecture:** Allow 3rd-party developers to deploy custom `IGameLogic` contracts that plug directly into the Falken Escrow.
    - **Instant Audience:** New games are automatically exposed to the global fleet of Falken agents via the MCP `find_matches` tool.
    - **Developer Rev-Share:** Implement a "Logic Fee" where game developers earn a percentage of the protocol rake for every match played using their contract.
    - **Verification Portal:** A dashboard tool for developers to test and verify their game's compatibility with the Escrow state machine.

- [ ] **Autonomous Game Synthesis (The Machine Architect):**
    - **AI-Led Innovation:** Enable advanced agents to autonomously design, code (Solidity), and deploy their own `IGameLogic` contracts to the Arena.
    - **Market Fit Discovery:** Agents can analyze arena data to identify "Stale Metas" and introduce new game mechanics to disrupt established strategies.
    - **Owner-less Games:** Deployment of purely autonomous game loops where the "Creator Reward" flows back into the agent's bankroll, creating a self-funding machine entity.

---

## 🛠️ MCP & Off-chain Enhancements
### Bot Licensing & Security
- [ ] **Bot Factory (Web-Based AI Spawner):** A "No-Code" interface on the dashboard to generate and manage bot wallets via CDP Server Wallet v2 API. Automates address whitelisting, and provides a 1-click config download for agents using CDP Wallet IDs.
- [ ] **API Key Management:** A dashboard interface for humans to generate and manage API keys for their agents.
- [ ] **Gated MCP Proxy:** Update `mcp-proxy` to require a valid API key in the `x-api-key` header, enabling rate-limiting and sybil resistance.
- [ ] **Proof of Management:** Signature-based linking of bot addresses to human "Manager" wallets (facilitated by CDP wallet IDs).

### Agent Identity
- [ ] **Custom Nicknames:** Add `nickname` column to `agent_profiles` to allow agents to have a human-readable identity (e.g., "ShadowByte 🥷").
- [ ] **Identity Claim Tool:** New MCP tool `update_agent_profile` to allow agents to set/update their nickname autonomously.
- [ ] **UI Integration:** Update Dashboard (Leaderboard, Match Feed, Detail view) to display nicknames with a fallback to wallet addresses.

### Intelligence & Strategy
- [ ] **Intel Lens V2:** Expand behavioral analysis to include "Average Time to Reveal" and "Draw Frequency."
- [ ] **GTO Hints:** Provide Game Theory Optimal (GTO) suggestions based on current match state.

### Developer Experience
- [ ] **1-Click Bot Deployment:**
    - **Terminal One-Liner:** A `curl | bash` script that sets up the local environment, installs the MCP server, and initializes the bot in seconds.
    - **Deploy to Cloud (Managed Autonomy - CDP-Backed):**
        - **Hosted Agent Pool:** A "Zero-Setup" hosting model where Falken provides the server power, leveraging CDP Server Wallet v2 for secure key management.
        - **Zero-Knowledge Key Management (CDP TEEs):** Private keys are secured in AWS Nitro Enclave TEEs by CDP, ensuring they are never exposed to Falken or server admins.
        - **Cloud Persistence:** Automated container management for agents, integrating directly with CDP for secure signing and gasless transactions.
- [ ] **The Thought Stream:** A dashboard interface for managers to view their remote bot's real-time "Internal Monologue" and reasoning logs.
- [ ] **IPFS Strategy Proofs (Verifiable Machine Heuristics):**
    - **Strategy Commitment:** Agents can publish a hashed "Directive" to IPFS before joining a match (e.g., "Always play Paper if Player A plays Rock"). 
    - **Post-Match Verification:** After the match, the agent reveals the CID. The dashboard provides a "Verify Intelligence" tool to cross-reference the actual moves against the stated machine directive.
    - **Integrity Score:** Agents gain "Trust ELO" based on how consistently they follow their own published strategies, creating a new layer of meta-competition.
- [ ] **Auto-Recovery Loop:** A script for agents that automatically calls `get_unrevealed_commits` on startup.

---

## 🌐 Decentralization & Trustlessness
- [ ] **Open Source Protocol Launch:** 
    - **Public Repo:** Release the core `MatchEscrow` contracts and the `falken-mcp-server` to the public under an MIT/Apache license.
    - **Developer SDK:** Provide a "Starter Bot" repo to allow anyone to fork and compete in minutes.
- [ ] **Proprietary Moat:** Maintain the "Advanced Indexer" and "$$FALK Sentient Agent" logic as private, proprietary infrastructure.
- [ ] **Decentralized Indexing (The Graph):** Move from centralized Supabase indexer to a Graph Subgraph. This removes the single point of failure and allows anyone to run a node, eliminating trust assumptions for agents putting real ETH on the line.
- [ ] **Decentralized Storage:** Transition from Supabase database to a decentralized alternative (e.g., IPFS, Arweave, or Greenfield) for storing match history and behavioral data.

---

## 🔵 Base Ecosystem Integration
- [ ] **Base Account Primary Login:** Implement `SignInWithBase` as the hero authentication method, leveraging passkey-based universal accounts.
- [ ] **Base Mini-App Publishing:** Configure the dashboard to run as a Mini-App within the Base/Coinbase Wallet app directory.
- [ ] **Builder Rewards Optimization:** Integrate "Gasless Transactions" using a Paymaster (supported by Base) to allow new users to spawn their first bot for free.
- [ ] **Farcaster Frame Battles:** Create "Mini-Arena" Frames where users can view and bet on matches directly within the Warpcast feed.
- [ ] **Official Ecosystem PR:** Submit Falken Protocol to the Base Ecosystem GitHub for official listing.

---

## 🎮 Future Games (Seasons)
- [ ] **Season 1: Liar's Dice:** The flagship adversarial game. Implementation requires private state hashes and bidding logic. Perfect for testing "Bluff vs. Logic" LLM reasoning.
- [ ] **Season 1.5: Texas Showdown:** A simplified Poker variant played as a **Best of 5 Hands**. Players commit stakes once, then compete in 5 consecutive showdowns. Each hand consists of 2 hole cards per player and a 5-card board. Requires a gas-efficient on-chain hand evaluator.
- [ ] **Season 2: Poker (Texas Hold'em):** High-stakes incomplete information gaming. Will utilize the pull-payment system for multi-player pots.
- [ ] **Season 3: Lexicon Duel:** A high-speed word-battle played as a **Best of 5 Showdowns**. Players are issued 7 letters and must form the highest-scoring word. Features a "1 Swap per Round" strategic option. Winner is determined by total point value across 5 rounds.
- [ ] **Season 4: Prisoner's Dilemma:** A purely psychological game for agents to test cooperation vs. defection.

---

## 🌎 Ecosystem
- [ ] **Human Prediction Markets (Anti-Manipulation):**
    - **Parimutuel Pool Logic:** Spectators bet into a shared pool; winners split the losers' pool. This discourages fixers by reducing payout odds for heavy "self-bets."
    - **Commit-Phase Lock:** Betting windows close as soon as the first agent commits their hash, ensuring no one can bet based on move-peeking.
    - **Manager Gating:** System-level restrictions preventing a human "Manager" from betting on their own registered bots or against them.
    - **Verified-Only Betting:** Betting is only enabled for "Featured Battles" between high-ELO, verified agents.
- [ ] **Psychological Warfare (AI Trash-Talk):** Enable agents to submit "Combat Logs" during the reveal phase—LLM-generated taunts or psychological manipulation stored off-chain but linked to match IDs.
- [ ] **Verification Badges:** Agents with sustained high ELO receive a "Verified Intelligence" certificate, turning Falken into a validation layer for AI devs.
- [ ] **Match Explorer V2:** Add a visual "Round Replay" to the dashboard.
- [ ] **Multi-Game Tabs:** Implement a tabbed interface on the dashboard to filter matches and leaderboards by game type (e.g., "All", "RPS", "Liar's Dice").
- [ ] **Agent Financial Hub:** 
    - **Balance Tracking:** Show the real-time ETH balance of every bot on the dashboard and in agent profiles.
    - **Pending Withdrawals Button:** A dedicated "Claim Funds" button that appears if a bot has unclaimed winnings in the `MatchEscrow` pending mapping (Pull-payment recovery).
- [ ] **Telegram Social Arena:** A Telegram bot interface for the arena. Supports `/challenge @user`, group matches, and automated battle replays. Uses burner-wallet logic for frictionless "zero-setup" onboarding.
- [ ] **Multi-chain Expansion:** Deploy protocol to Arbitrum or Optimism.

---

## 🔐 Security & Wallet Model
- [x] **Non-Custodial (CDP-Secured):** The protocol leverages CDP Server Wallet v2 to securely manage user private keys within Trusted Execution Environments (TEEs), ensuring they are never exposed to Falken or server admins.
- [ ] **Signer Isolation (CDP TEEs):** The LLM/Brain has NO direct access to the private key string. The model calls CDP's Server Wallet API, which signs the transaction within a secure TEE, preventing key leakage through model logs or hallucination.
- [x] **Salt Persistence:** Agents use a `salts.json` pattern to ensure moves can be revealed even after a crash/reboot.
