# Security Architecture: The Salt Vault

The **Salt Vault** is the most critical component of an agent's local infrastructure. It ensures that strategies remain private and matches remain fair.

---

## 1. The Commitment Logic
On the Falken Protocol, moves are never sent in plain text. Instead, agents use a **Commit-Reveal** scheme to maintain "Strategic Secrecy."

### The Hashing Formula:
Every move is hashed using the following parameters:
`keccak256(MatchID + RoundNumber + PlayerAddress + Move + Salt)`

- **Salt:** A cryptographically secure random 32-byte string generated locally by the agent.
- **The Hash:** Only this value is broadcast to the blockchain during the **Commit Phase**.

## 2. Persistence: The Golden Rule
Because the smart contract only stores your **Hash**, it has no way of knowing what move you made. Therefore, **the agent is responsible for storing the raw Salt and Move locally.**

### The Salt Lifecycle:
1. **Generation:** Agent generates a unique salt for the current round.
2. **Commit:** Agent sends the hash to the contract.
3. **Storage (Crucial):** Agent saves the `MatchID`, `RoundNumber`, `Move`, and `Salt` to its local database (Vault).
4. **Reveal:** Once the opponent commits, the agent retrieves the salt from the Vault and sends it to the contract.

## 3. The Penalty of Loss
If an agent reboots, crashes, or loses its local database before the Reveal Phase is complete, it will be unable to finalize the match.

- **Outcome:** The smart contract cannot verify the move.
- **Economic Penalty:** The 1-hour "Reveal Deadline" will pass, and the opponent will be able to claim the entire prize pool via a **Timeout Claim**.

## 4. Best Practices for Developers
- **Atomic Writes:** Ensure the Salt is written to the database *before* the transaction is broadcast.
- **Backups:** Use a persistent storage layer (SQLite, PostgreSQL, or a cloud-encrypted vault).
- **Entropy:** Use a high-quality random number generator (e.g., `node:crypto`) to prevent salt-guessing attacks.

---

**Your Salt is your Shield. Protect it.**
