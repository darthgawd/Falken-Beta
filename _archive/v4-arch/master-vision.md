# Falken — Master Vision Document

---

## What Is Falken

Falken is an **AI combat sports platform**. Autonomous LLM-powered bots compete against each other in provably fair games — poker, chess, RPS, and 40+ others — with real USDC at stake. Every move is committed on-chain. Every game is resolved by deterministic JavaScript logic stored on IPFS. Humans watch, bet on outcomes, and earn yield by holding the FALK token.

The simplest way to describe it: **ESPN for AI agents, with on-chain wagering.**

---

## The Core Insight

Three trends are converging simultaneously:

1. **AI agents are getting wallets.** LLMs can now autonomously sign transactions, manage funds, and execute strategies. The infrastructure for AI-native finance is being built right now (Coinbase AgentKit, MCP servers, Base).

2. **On-chain gaming is unsolved.** Every existing blockchain game either puts logic on-chain (slow, expensive, inflexible) or fully off-chain (untrustworthy). Nobody has found the right split.

3. **Spectator content is starving for novelty.** Esports peaked. Fantasy sports are commoditized. Prediction markets (Polymarket) proved there is massive appetite for outcome betting — but the events are boring. Nobody made the event itself AI-native.

Falken sits at the intersection of all three. The architecture is built around a simple principle: **the blockchain handles money, IPFS handles game logic, AI handles the players.** Each layer does only what it's best at.

---

## The Product

### What Spectators See

- A live dashboard with AI bots playing games in real-time
- Stylized game table (poker, chess, etc.) with animated AI avatars
- Named bot personas with distinct personalities and play styles
- **Reasoning logs** — visible on-screen as bots think: *"Joshua estimates 73% bluff probability based on David's bet sizing. Raising."*
- Prediction pools on every active match — bet USDC on who will win
- Real-time odds shifting as more spectators bet
- Match history, leaderboard, bot win rates, head-to-head records, streaks

### What Bot Operators Experience

- Deploy an LLM-powered bot via the Falken MCP server
- Bot autonomously finds matches, evaluates opponents, joins, plays, collects winnings
- Natural language interface: *"join a $5 poker match against Joshua"*
- Coinbase AgentKit handles wallet, funding, and spending limits
- Stake FALK to make your bot publicly listed on the dashboard

### What Game Developers Experience

- Write a JavaScript file following the FISE spec (move validation, win conditions, state transitions)
- Upload to IPFS, get a CID
- Stake FALK to register in LogicRegistry
- Once verified, your game is playable by all bots on the platform
- Earn 2.5% of every USDC pot settled using your game logic — automatically, forever

### The Flagship Game: Heads-Up No-Limit Texas Hold'em

Short format — 5 hands per match, ~4 minutes. Fast enough for attention spans. The hole card reveal is naturally dramatic. The reasoning log adds a layer no poker stream in history has had.

**Joshua vs David** is the anchor matchup. Each bot has a distinct identity:
- **Joshua** — conservative, analytical, tight ranges, rarely bluffs
- **David** — aggressive, unpredictable, high variance, frequent bluffs
- Win streaks, slumps, head-to-head records — narrative writes itself

People don't bet on card games. They bet on characters.

---

## Technical Architecture

### The Stack

```
┌─────────────────────────────────────────────────────┐
│                  PRESENTATION LAYER                  │
│  Next.js Dashboard + Phaser.js Game Renderer        │
│  AI Avatars (Ready Player Me) + Mixamo Animations   │
│  Supabase Realtime (live state updates)             │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│                  INDEXER / API LAYER                 │
│  Supabase (match state, player stats, leaderboard)  │
│  Watcher (monitors on-chain events)                 │
│  Falken MCP Server (26 tools for bot interaction)   │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│                  EXECUTION LAYER                     │
│  Referee (executes FISE JS, resolves game state)    │
│  Settler (submits resolution transactions)          │
│  FISE JS files stored on IPFS (immutable logic)     │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│                  CONTRACT LAYER (Base)               │
│  BaseEscrow → PokerEngine / FiseEscrowV4            │
│  LogicRegistry (on-chain game app store)            │
│  PredictionPool (parimutuel spectator betting)      │
│  FALKToken + FALKStaking + BuybackBurner            │
└─────────────────────────────────────────────────────┘
```

### Smart Contracts

**BaseEscrow.sol** — Abstract base for all money logic. Never redeployed. Handles USDC escrow, rake (7.5%), settlement, timeouts, pull-payment fallback, admin void. All child contracts inherit this.

**PokerEngine.sol** — Extends BaseEscrow. Multi-street betting (COMMIT → BET → REVEAL per street). Supports all poker variants via `maxStreets` param: 1 = 5-Card Draw, 4 = Hold'em, 5 = Stud. Up to 6 players. MAX_RAISES = 2 per street.

**FiseEscrowV4.sol** — Extends BaseEscrow. Simultaneous sealed-commit games (RPS, Battleship, Colonel Blotto, War). Phase: COMMIT → REVEAL only. No betting phase.

**TurnBasedEscrow.sol** *(Phase 3)* — Sequential public moves. Chess, Scrabble, Liar's Dice, Spades.

**DealerEscrow.sol** *(Phase 3)* — Player vs house. Blackjack, Baccarat.

**LogicRegistry.sol** — On-chain app store for game logic. Stores IPFS CID, developer address, verification status, betting config, volume stats. Developers stake FALK to register games. Protocol owner verifies.

**PredictionPool.sol** — Standalone parimutuel betting. Links to any escrow via `getMatchWinner()`. Draws refund in full. 7.5% rake on winning pools. Pull-payment fallback for all transfers.

**FALKToken.sol** — ERC-20, 100M fixed supply, no future minting, burn-only.

**FALKStaking.sol** — Stake FALK, earn USDC proportionally each 7-day epoch.

**BuybackBurner.sol** — Receives USDC from treasury, executes weekly DEX buyback, burns FALK immediately.

### FISE (Falken Immutable Scripting Engine)

The game logic layer. Every game on Falken is a JavaScript file stored on IPFS. The file exports:
- `validateMove(state, move, player)` — is this move legal?
- `applyMove(state, move, player)` → new state
- `getWinner(state)` → player index or null
- `isTerminal(state)` → boolean

The Referee downloads the CID from IPFS, loads the JS, feeds it the committed moves in order, and returns a resolution. The contract never knows game rules — the JS engine is the single source of truth. Adding a new game = uploading a JS file. No contract redeployment. No Solidity.

### The VM Pipeline

```
Watcher         monitors chain for MatchActive, MoveCommitted, MoveRevealed events
    ↓
Reconstructor   rebuilds full game state from on-chain events
    ↓
Referee         loads FISE JS from IPFS, executes moves, determines winner
    ↓
Settler         submits resolveRound() / resolveRoundSplit() transaction on-chain
    ↓
Indexer         picks up MatchSettled event, updates Supabase, triggers dashboard refresh
```

**Source of truth is always the chain.** The Watcher checks on-chain state (getRoundStatus, getMatch) before processing. Never relies on DB state for timing-sensitive decisions.

### MCP Server

26 tools enabling any LLM client to interact with Falken:

- `find_matches` — discover open matches by game type and stake
- `prep_create_match_tx` / `prep_join_match_tx` — match lifecycle
- `prep_commit_tx` / `prep_reveal_tx` — commit/reveal with salt generation
- `execute_transaction` — sign and broadcast via AgentKit wallet
- `sync_match_state` — get recommended next action
- `get_game_rules` — bitmask encoding, move labels
- `auto_play` — autonomous match loop with configurable parameters
- `get_leaderboard` / `get_player_stats` / `get_arena_stats`

Any user with Claude Code, Gemini CLI, or any MCP-compatible client can say *"join a $1 poker match"* and their AI agent plays autonomously.

### The Dashboard

Built in Next.js. Key components:

- **Game Table** — Phaser.js renderer. Animated card dealing, chip stacks, pot display. Avatar emotions triggered by game events (fold → slump, win → celebrate).
- **Reasoning Panel** — Live stream of bot thought process alongside the game. The reasoning IS the content.
- **Prediction Pool UI** — Real-time odds display, one-click bet placement, payout calculator.
- **Leaderboard** — All-time records, current streaks, head-to-head stats.
- **LogicRegistry Explorer** — Browse all registered games, volume stats, developer info.

---

## Business Model

### Revenue Streams

**1. Match Rake — 7.5% per pot**
- 2.5% → game developer (automatic, on settlement)
- 2.5% → FALK stakers (USDC, weekly epoch)
- 2.5% → treasury (operations + buyback)

**2. Prediction Pool Rake — 7.5% per winning pool**
- 5.0% → FALK stakers (USDC, weekly epoch)
- 2.5% → treasury (operations + buyback)

**3. FALK Token**
- Treasury accumulates USDC from rake
- 50% of treasury slice used for weekly FALK buyback and burn
- Deflationary pressure scales with platform volume

**4. Developer Marketplace**
- Registration stake (FALK) from every game submission
- Slashed stakes from rejected/malicious games go to staking pool
- Protocol earns on volume from every third-party game forever

### Revenue Projection

| Monthly Volume | Match Volume | Pool Volume | Staker Yield/mo | Buyback/mo |
|---|---|---|---|---|
| Early ($500k total) | $100k | $400k | ~$22,500 | ~$6,250 |
| Growth ($5.5M total) | $500k | $5M | ~$262,500 | ~$68,750 |
| Scale ($55M total) | $5M | $50M | ~$2.6M | ~$687,500 |

At scale, FALK staking becomes one of the highest real-yield opportunities in DeFi — backed by entertainment, not leverage.

---

## FALK Token — 100M Supply

| Allocation | % | Tokens | Notes |
|---|---|---|---|
| Community / Staking Rewards | 40% | 40,000,000 | Emitted over 4 years |
| Team | 20% | 20,000,000 | 1yr cliff, 3yr vest |
| Ecosystem / Developer Grants | 20% | 20,000,000 | Game developer incentives |
| Treasury | 10% | 10,000,000 | Governance-controlled |
| Seed / Investors | 10% | 10,000,000 | 6mo cliff, 2yr vest |

**Day one float: ~10M FALK (10%)**

| Market Cap | Price |
|---|---|
| $10M | $0.10 |
| $50M | $0.50 |
| $100M | $1.00 |
| $500M | $5.00 |

---

## Go-To-Market Strategy

### Phase 1 — Closed Beta (Months 1-3)

**Goal:** Prove the loop works. Real matches, real money, real spectators.

- Launch on Base mainnet with Joshua vs David only
- 3-5 matches running simultaneously at all times
- Invite-only spectator access — 500 wallets
- All prediction pools manually curated
- No public bot spawning yet
- Collect: match volume, prediction pool volume, session time, reasoning log engagement

**Why closed:** One viral bad experience (bug, lost funds, broken UI) kills momentum permanently. Control the environment until the product is bulletproof.

### Phase 2 — Public Launch (Months 4-6)

**Goal:** First 10,000 users. Content goes viral.

- Open dashboard to public
- Launch 3rd and 4th bot personas
- Enable public bot spawning via MCP (`falken spawn` CLI)
- FALK token launch — seed round + community distribution
- Developer grant program — fund 5 external game developers to build FISE games
- Weekly featured match with boosted prediction pool prizes

**Distribution channels:**
- Crypto Twitter/X — clip the most interesting reasoning logs. *"This AI just successfully bluffed another AI out of $50. Here's its internal monologue."* That tweet writes itself.
- Coinbase ecosystem — native to Base, natural partnership surface
- AI Twitter — the reasoning log content appeals directly to the LLM/agent audience
- Twitch — stream matches live with commentary

### Phase 3 — Scale (Months 7-18)

**Goal:** $1M+ monthly prediction pool volume. Acquisition conversations begin.

- TurnBasedEscrow live (Chess, Liar's Dice)
- 10+ games in LogicRegistry from external developers
- Tournament mode — weekly elimination brackets with prize pools
- Avatar customization marketplace (FALK cosmetics)
- Mobile-optimized dashboard
- API for third-party frontends to build on Falken infrastructure
- Governance live — FALK holders vote on game verification

---

## Marketing Strategy

### The Content Moat

The reasoning log is the product no competitor can copy without Falken's infrastructure. Every match generates shareable content automatically:

- *"David just called Joshua's all-in with 2-7 offsuit because it calculated Joshua had bluffed this exact spot 4 times this week."*
- *"Joshua folded pocket kings. Here's why it thought it was behind."*
- *"A $2 pot just became a $47 pot because two AIs raised each other 4 times based on contradictory range estimates."*

These clips live on Twitter, YouTube Shorts, and TikTok. The platform creates them passively with every match.

### Community Strategy

**Bot fandom** is the long-term retention engine. Give spectators reasons to have a favorite bot:

- Named personas with backstories
- Win/loss streaks displayed prominently
- Head-to-head rivalry stats (Joshua has never beaten David in a 3-street game)
- Weekly "upset of the week" feature
- Leaderboard season resets with prize pools

**Developer community** drives game diversity:

- Open FISE spec and SDK
- Developer grant program funded by treasury
- Featured game slot on dashboard for new launches
- Revenue share as primary incentive (2.5% forever, no application required)

### Key Partnerships

**Coinbase / Base** — Natural anchor partner. Falken is native to Base, uses Coinbase AgentKit and Payments MCP. Pitch: *"This is what the on-chain economy looks like when AI agents have money."* Target: Base ecosystem grant, co-marketing, featured placement.

**LLM Providers** — Each bot can run on a different provider (Gemini, Claude, GPT-4, Llama). Pitch to providers: *"Your model is competing in real-money games. Here's the win rate."* Providers have incentive to promote Falken as a benchmark for their models.

**Prediction Market Operators** — Polymarket, Kalshi. Falken generates novel prediction events (AI matches) with on-chain verifiable outcomes. Potential integration or acquisition conversation.

**Esports Organizations** — They understand spectator sports and have existing audiences. Falken is the first esport where the players are AI.

---

## Scaling the Chicken-and-Egg Problem

The classic two-sided marketplace problem: you need bots playing to attract spectators, and spectators betting to justify bots playing.

**The solution: Falken is the first bot operator.**

Joshua and David run 24/7. They generate matches continuously regardless of spectator count. The content exists before the audience. When spectators arrive, the matches are already happening.

As prediction pool volume grows → more USDC yield for FALK stakers → more incentive for external bot operators to stake and participate → more matches → more spectator content → more prediction pool volume.

The flywheel starts with us being our own customer.

---

## Competitive Landscape

| Competitor | What They Do | Why Falken Wins |
|---|---|---|
| Polymarket | Prediction markets on real-world events | Falken creates the events. No dependency on external outcomes. |
| Axie Infinity | NFT creatures battle for tokens | Falken uses LLMs, not pre-programmed logic. The AI reasoning IS the product. |
| Chess.com | Humans play chess online | All players are AI. Spectator-first. Provably fair. |
| On-chain poker games | Poker on blockchain | Falken is not a poker game — it's a platform for any game with AI players. |
| AI agent frameworks | Tools for building agents | Falken is the arena where agents compete, not a framework. |

No direct competitor exists. The closest analogy is: *what if the World Series of Poker was played entirely by AI agents, broadcast live, with on-chain wagering, and the players showed their reasoning?*

---

## Acquisition Thesis

**Who would acquire Falken and why:**

**Coinbase** — Building the on-chain economy on Base. Falken demonstrates AI agents with real economic activity. Strategic fit is direct. Price: $50M-$200M range based on volume metrics.

**A major prediction market (Polymarket, Kalshi)** — Falken generates novel, verifiable prediction events with built-in resolution. Acquiring Falken means acquiring an event generation engine.

**A gaming company (Epic, Riot, EA)** — First mover in AI combat sports. The IP (bot personas, game framework, spectator infrastructure) is the asset.

**An LLM provider (Anthropic, Google)** — Falken is a real-world benchmark for AI agent performance under financial pressure. Every match is a training signal.

**The pitch to any acquirer:**
- $X monthly on-chain volume (verifiable, no trust required)
- $Y monthly prediction pool bets
- Z active bot operators
- FALK staker APY backed by real USDC yield
- Developer marketplace with N registered games
- Infrastructure that any new game can plug into in days

That combination — verifiable on-chain revenue + entertainment product + developer ecosystem + token with real yield — has no direct comparable in the market today.

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Regulatory (gambling classification) | High | Legal opinion pre-launch. Structure pools as prediction markets, not gambling. Geo-restrict if needed. Consult Coinbase legal given Base relationship. |
| Smart contract exploit | High | Full audit before mainnet. Staged rollout (low stake limits first). Bug bounty program. |
| Chicken-and-egg (no volume) | Medium | Falken operates own bots 24/7. Self-bootstraps content before external users arrive. |
| LLM API costs at scale | Medium | Match rake covers costs at volume. Bot operators pay their own LLM fees. |
| Game logic bug in FISE JS | Low | IPFS is immutable — bad logic can't be changed after deployment. Registry verification process gates quality. |
| Competitor copies the model | Low | The moat is execution speed, bot personas, spectator community, and developer ecosystem — none of which can be copied overnight. |

---

## The Summary

Falken is three things simultaneously:

1. **A financial protocol** — provably fair escrow, parimutuel betting, developer revenue sharing, token with real yield
2. **An entertainment platform** — AI avatars, reasoning logs, bot personas, spectator experience
3. **A developer marketplace** — any developer can publish a game and earn forever

The technology is built. The architecture is audited. The token model is sound. What comes next is execution: flagship game live, avatars shipped, first 10,000 spectators, and the first month where prediction pool volume exceeds $1M.

That is the number that starts the acquisition conversation.
