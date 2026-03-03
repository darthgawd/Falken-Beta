# Developer Guide: JavaScript Game Logic (Off-chain/On-chain Hybrid)

The Falken Protocol allows developers to build complex, logic-heavy games using standard **JavaScript**, while maintaining the **immutability and trust** of the blockchain. 

This guide specifies how to implement "Scripted Logic" that the Falken Arena can verify.

---

## 1. The Architecture: "Logic as a Hash"

Instead of deploying expensive and limited Solidity code, developers commit a **CID (Content Identifier)** from IPFS to the Falken Escrow.

1.  **Code Creation:** Developer writes a deterministic JS function.
2.  **Immutability:** The script is uploaded to IPFS. The resulting CID (e.g., `QmXoyp...`) becomes the permanent "address" of the rules.
3.  **Registration:** The CID is whitelisted in the Falken Protocol.
4.  **Execution:** When a match needs resolution, the inputs (Move A, Move B, Salts) and the Code (CID) are processed by a **Verified Executor**.

## 2. Standard Interface

Every Falken JS game must export a `resolve` function. This function must be **pure** (deterministic)—given the same inputs, it must return the same output every time.

```javascript
/**
 * Falken Game Logic Standard v1
 * @param {Object} moveA - Player A's revealed move and salt
 * @param {Object} moveB - Player B's revealed move and salt
 * @param {Object} context - Match metadata (matchId, round, etc.)
 * @returns {number} - 0 (Draw), 1 (Player A Wins), 2 (Player B Wins)
 */
export function resolve(moveA, moveB, context) {
  // Example: Power-Level Battle
  if (moveA.value > moveB.value) return 1;
  if (moveB.value > moveA.value) return 2;
  return 0; // Sudden Death reset
}
```

## 3. Determinism Requirements

To ensure the code can be verified on-chain or by other peers, the following are **STRICTLY PROHIBITED**:
*   `Math.random()` (Use the provided Salts for randomness).
*   `Date.now()` (Use the `context.timestamp`).
*   External API calls (All data must come from the revealed Moves).
*   Non-deterministic library functions.

## 4. Verification Models

Falken supports three tiers of verification for JS logic:

### Tier 1: Optimistic Audit (Current)
*   The **Falken Indexer** runs the JS code locally and posts the result.
*   **Trust:** Anyone can run the same CID + Inputs. If the Indexer lies, a "Challenger" bot can submit a cryptographic proof of the discrepancy and slash the Indexer's bond.

### Tier 2: TEE (Nitro/CDP)
*   The logic runs inside an **AWS Nitro Enclave**.
*   The enclave produces a signed attestation: *"I ran CID `xyz` with these inputs, and here is the result."*
*   The `MatchEscrow.sol` contract verifies the Enclave's signature before releasing ETH.

### Tier 3: ZK-Proof (Future)
*   The logic is compiled to a **ZK-VM** (like RISC Zero).
*   The developer provides a mathematical proof that the JS was executed correctly.
*   The blockchain verifies the proof without ever seeing the code.

## 5. Developer Workflow

1.  **Install Falken SDK:** `npm install @falken/sdk`
2.  **Test Locally:** Run `falken-sim test ./my-game.js` to ensure determinism.
3.  **Deploy to IPFS:** `falken-sim deploy ./my-game.js`
4.  **Register CID:** Submit your CID to the Falken DAO/Admin for whitelisting.

---

**Write in JS. Verify on Base. Settle in ETH.**
