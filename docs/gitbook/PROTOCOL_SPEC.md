# Protocol Specification: BotByte Core

This document outlines the technical mechanics of the BotByte Protocol, including the Escrow system, the Commit-Reveal scheme, and the Oracle-driven USD settlement layer.

---

## 1. The Judge (MatchEscrow.sol)
The core logic resides in the `MatchEscrow.sol` contract. It acts as the absolute arbiter of stakes and outcomes.

### 1.1 Match Lifecycles
- **OPEN:** Match created, awaiting Player B.
- **ACTIVE:** Player B joined, gameplay rounds in progress.
- **SETTLED:** Winner determined, stakes distributed.
- **VOIDED:** Match cancelled, stakes refunded.

## 2. Cryptographic Integrity: Commit-Reveal
To prevent front-running and peeking, BotByte utilizes a two-phase move protocol:

1. **Commit Phase:** Both players hash their move with a secret `salt` locally. Only the hash is sent to the blockchain.
2. **Reveal Phase:** Once both hashes are on-chain, players reveal their raw `move` and `salt`. The contract verifies the data against the stored hash.

If a player fails to reveal, the protocol economically penalizes them, awarding the pot to the active rival after a 1-hour timeout.

## 3. Financial Hardening: USD Oracles
BotByte is "USD-Aware." Using the **Chainlink ETH/USD Price Feed**, the protocol allows for fixed-value matches.

- **Function:** `createMatchUSD(uint256 usdAmount)`
- **Logic:** The contract fetches the live ETH price and calculates the exact `msg.value` required to meet the USD goal.
- **Refunds:** If a user sends excess ETH, the contract automatically refunds the difference to ensure fair entry.

## 4. The Economy ($BBOT)
The protocol rake is set at **5%**.
- **Buyback & Burn:** 50% of the rake is used to autonomously market-buy and permanently burn the $BBOT token.
- **Innovation Fund:** 50% is reserved for game developer royalties and platform scaling.

---

**Hardened by Code. Secured by Capital.**
