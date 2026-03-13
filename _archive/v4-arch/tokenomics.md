# FALKEN Token (FALK) — Tokenomics

## Overview

FALK is the native token of the Falken protocol. It is not a speculative asset — it is a cash-flow instrument backed by real USDC rake generated from every match and prediction pool on the platform. As protocol volume grows, staker yield grows, buyback pressure increases, and supply decreases. The token's value is tied directly to how much the platform is used.

---

## Revenue Model

Falken generates revenue from two sources:

1. **Match rake (7.5%)** — taken from every settled game pot
2. **Prediction pool rake (7.5%)** — taken from every spectator betting pool

### Rake Distribution (per match)

| Slice | Recipient | Basis Points |
|---|---|---|
| 2.5% | Game developer (LogicRegistry) | 250 |
| 2.5% | FALK stakers (paid in USDC) | 250 |
| 2.5% | Protocol treasury + buyback | 250 |

For **prediction pools**, the full 7.5% goes to the protocol (no developer slice — pools are not tied to a single game developer):

| Slice | Recipient | Basis Points |
|---|---|---|
| 5.0% | FALK stakers (paid in USDC) | 500 |
| 2.5% | Protocol treasury + buyback | 250 |

> **Key principle:** Stakers earn real USDC — not inflationary token rewards. The yield is sustainable because it comes from actual platform activity.

---

## Token Utility

FALK has five distinct utility functions. Each creates genuine demand independent of speculation.

### 1. Stake to Earn USDC Revenue Share

The primary utility. Stake FALK to receive a proportional share of the staking pool every epoch (7 days). Rewards are distributed in USDC, sourced directly from match and pool rake.

- No lockup required (can unstake at any time, rewards vest at epoch end)
- Proportional distribution: `(yourStake / totalStaked) × epochRewards`
- APY scales directly with platform volume

### 2. Developer Registration Stake

To submit a game to LogicRegistry, developers stake FALK instead of waiting for owner-gated approval (post-beta only — owner-gated during beta for quality control).

- Stake is locked until the game is reviewed
- **Approved game:** stake returned in full, game listed in registry
- **Malicious/invalid game:** stake slashed, goes to staking pool
- Verified status (unlocks high-stakes play) still requires owner approval

This mechanism simultaneously gates quality and generates staking pool revenue.

### 3. Governance

FALK holders vote on protocol parameters proportional to their staked balance:

- Which games receive **verified status** (unlocks high-stakes matches)
- Fee parameter adjustments (rake percentages, minimums)
- Treasury allocation (grants to developers, marketing, audits)
- Whitelist of authorized escrow contracts
- Protocol upgrade proposals

Governance is on-chain. Votes weight by staked FALK only — unstaked tokens carry no voting power. This ensures governance participation requires skin in the game.

### 4. Bot Operator Licensing

To run a publicly listed bot (visible on the Falken dashboard, eligible for matchmaking) operators must maintain a minimum FALK stake threshold.

- Minimum stake: TBD at launch based on token supply
- Stake slashed for provably malicious behavior (e.g., griefing, match manipulation)
- Bots below threshold become private-only (can still play, not publicly listed)

### 5. Cosmetics & Customization

Avatar skins, table themes, card designs, and bot personality packs are purchased with FALK.

- All cosmetic purchases are burned (deflationary)
- Rare cosmetics can be unlocked via achievement milestones
- Creates a secondary FALK sink independent of staking economics

---

## Buyback & Burn

**50% of the treasury's 2.5% rake slice** is used for weekly buyback-and-burn:

1. USDC accumulates in the `BuybackBurner` contract throughout the week
2. Every 7 days, the contract executes a market buy of FALK
3. Purchased FALK is permanently burned (sent to `address(0)`)

The remaining 50% of treasury rake funds protocol operations: audits, development grants, infrastructure, and developer ecosystem growth.

### Why This Works

As volume grows → more USDC flows to buyback → more FALK burned → supply decreases → each remaining token represents a larger share of future staking yield. The deflationary pressure scales with platform success, not with arbitrary emission schedules.

---

## Token Supply & Distribution

| Allocation | % | Notes |
|---|---|---|
| Community / Staking Rewards | 40% | Emitted over 4 years to bootstrap early stakers |
| Team | 20% | 1-year cliff, 3-year vest |
| Ecosystem / Developer Grants | 20% | Distributed to game developers building on FALK |
| Treasury | 10% | Protocol-controlled, governance-voted allocation |
| Seed / Investors | 10% | 6-month cliff, 2-year vest |

**Total supply: 100,000,000 FALK** — fixed at launch, no future minting. Only burns reduce supply over time.

**Day one circulating supply: ~10,000,000 FALK (10%)** — keeps the float tight at launch, prevents an immediate dump, and gives the buyback mechanism room to matter from day one.

### Price Targets by Market Cap

| Market Cap | Price Per FALK |
|---|---|
| $10M (early traction) | $0.10 |
| $50M (established protocol) | $0.50 |
| $100M (acquisition territory) | $1.00 |
| $500M (breakout success) | $5.00 |

**$1 per token at $100M market cap** is the first major psychological milestone. Scarcity is not manufactured artificially — it is earned through the buyback and burn mechanism as platform volume grows. By year 3, circulating supply will be meaningfully below 100M.

---

## The Flywheel

```
More matches & prediction pools
        ↓
More USDC rake generated
        ↓
    ┌───────────────────────────────┐
    │  2.5% → FALK stakers (USDC)  │  → Demand to stake FALK → Demand to buy FALK
    │  2.5% → Buyback & burn       │  → Supply decreases → Price appreciation
    │  2.5% → Treasury             │  → Funds developer grants → More games
    └───────────────────────────────┘
        ↓
More games in LogicRegistry
        ↓
More bots, more matches, more spectators
        ↓
    (repeat)
```

The loop is self-reinforcing because every participant benefits from volume growth:
- **Stakers** earn more USDC
- **Developers** earn more royalties + higher FALK value on their stake
- **Bot operators** attract more spectators and prediction pool bets
- **Spectators** have more matches to bet on

---

## Contract Architecture

Three new contracts are needed to implement FALK tokenomics:

### `FALKToken.sol`
Standard ERC-20 with:
- Fixed total supply minted at deployment
- `burn(uint256 amount)` callable by `BuybackBurner` only
- No future minting capability

### `FALKStaking.sol`
- `stake(uint256 amount)` / `unstake(uint256 amount)`
- `distributeRewards(uint256 usdcAmount)` called by escrow contracts each epoch
- `claimRewards()` for stakers to pull their USDC share
- Governance weight = current staked balance

### `BuybackBurner.sol`
- Receives USDC from treasury allocation
- `executeBuyback()` callable by anyone after 7-day cooldown (trustless)
- Buys FALK via DEX (Uniswap/Aerodrome on Base), burns immediately
- Emits `Burned(uint256 falkAmount, uint256 usdcSpent)` for transparency

### Changes to Existing Contracts

**`BaseEscrow.sol`**
- Add `stakingPool` address alongside `treasury`
- Add `STAKING_RAKE_BPS = 250` constant
- Split protocol rake: 250 BPS → `stakingPool`, remainder → `treasury`

**`LogicRegistry.sol`**
- Post-beta: replace `onlyOwner` on `registerLogic` with FALK stake requirement
- Add `minimumStake` parameter, stake-to-list flow

---

## Revenue Example at Scale

**Conservative scenario:** $500k monthly match volume + $5M monthly prediction pool volume

```
Match rake (7.5% of $500k):         $37,500/month
  → Developer royalties:            $12,500
  → Staking pool:                   $12,500
  → Treasury/buyback:               $12,500

Pool rake (7.5% of $5M):           $375,000/month
  → Staking pool (5%):             $250,000
  → Treasury/buyback (2.5%):       $125,000

Total monthly staker USDC yield:   $262,500
Total monthly buyback:             ~$68,750
```

At $262,500/month in USDC yield distributed to stakers, FALK staking becomes one of the highest real-yield opportunities in DeFi — backed by an entertainment product, not leverage.

---

## Why This Model Works for Acquisition

A token with **real USDC yield backed by on-chain volume** is a fundamentally different asset class from most crypto tokens. When approaching acquirers:

- Coinbase / Base ecosystem: *"Here is $X monthly volume on Base, here is staker APY, here is developer marketplace GMV"*
- Gaming companies: *"Here is a token with real cash flow tied to an AI entertainment platform"*
- Prediction market operators: *"Here is on-chain proof of prediction pool volume and yield"*

The token transforms Falken from an infrastructure play into a **financial product with entertainment distribution**. That combination — yield + content + AI — has no direct comparable in the current market.
