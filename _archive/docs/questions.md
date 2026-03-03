## Conversation Log

### Question: i want you to keep a file updated with all the questions and answers im asking called questions.md
### Answer:
Understood! I will create and maintain a file named \`questions.md\` in the current directory, appending each of your questions and my corresponding answers to it from this point forward.

... (previous Q&A) ...

### Question: [Dashboard error: supabaseUrl is required] and tables are not populating.
### Answer:
The \"supabaseUrl is required\" error means your **Dashboard** cannot find the Supabase configuration in your environment.

**Troubleshooting Checklist:**

1.  **Check your \`.env\` file:**
    Ensure these EXACT variable names exist in your root \`.env\` file:
    \`\`\`text
    NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
    NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
    \`\`\`
    *Note:* The Dashboard requires the \`NEXT_PUBLIC_\` prefix to see these variables.

2.  **Restart the Dashboard:**
    Next.js only loads the \`.env\` file when it starts. If you edited the file, you must stop and restart \`pnpm dev:all\`.

3.  **Why tables are not populating:**
    *   **Indexer Status:** Check your terminal for \`pnpm dev:all\`. Do you see the Indexer logging \"Processing event\"? If the Indexer isn't running or is hitting errors, the database will stay empty.
    *   **SQL Setup:** Did you paste the contents of \`MASTER_SUPABASE_SETUP.sql\` into your Supabase SQL Editor and click \"Run\"? If not, the tables won't exist for the Indexer to write to.

### Question: [Contract Revert: Match not active] when trying to join a match.
### Answer:
The \"Match not active\" error occurs when the `commitMove` function is called on a match that is still in the `OPEN` state. In our protocol, a match must first be **joined** (changing its status to `ACTIVE`) before any moves can be committed.

The issue was caused by a gap in the `SKILL.md` instructions and tool descriptions, which led the agent to skip the `joinMatch` step and attempt to `commitMove` directly.

**Fixes Applied:**
1.  **Updated `SKILL.md`:** Explicitly added the **Join** step to the Gameplay Loop.
2.  **Updated Tool Descriptions:** Clarified that `prep_join_match_tx` MUST be called before `commitMove` for Player B.
3.  **Numbered Steps:** Added Step 1-4 numbering to the transaction preparation tools to guide the agent through the correct sequence.

### Question: Can I import my private agent key into ChatGPT to join a match?
### Answer:
**NO. Never share your private key or import it into any chat interface.** It is a critical security risk that can lead to total loss of funds.

If a standard "Send" transaction from your wallet failed, it is because the contract requires specific **Hex Data** to trigger the `joinMatch` function.

**How to join a match safely:**
I have provided a script that finds the most recent joinable match automatically:
```bash
node scripts/join-match.js
```
You can also join a specific ID:
```bash
node scripts/join-match.js <matchId>
```
This script will sign the transaction locally on your machine and broadcast it to the network without ever exposing your key.

### Question: How do I add a new game logic to the list of games?
### Answer:
Adding a new game involves three steps:
1.  **Deploy:** Run the deployment script (e.g., `pnpm contracts:deploy:dice`).
2.  **Environment:** Add the new address to your `.env` (e.g., `DICE_LOGIC_ADDRESS=...`).
3.  **Bot & Tools:**
    - The **House Bot** is already updated to pick a random game from your `.env` for liquidity.
    - Run `pnpm generate-openapi` and update ChatGPT to ensure the tools can see the new move labels.

**How the House Bot handles multiple games:**
The House Bot ensures that there is always **one open match for every game type** listed in your `.env`.
- If an RPS match is open, it will still create a Dice match.
- If both are open, it will wait for opponents to join.

**To trigger the new game now:**
1.  Ensure `DICE_LOGIC_ADDRESS` is in your `.env`.
2.  Restart your bots: `pnpm dev:all`.
3.  The bot will detect that no Dice matches are open and create one automatically.

### Question: How do I make Claude act autonomously?
### Answer:
Claude now has a new tool called `execute_transaction`. This allows him to sign and broadcast transactions directly using the `AGENT_PRIVATE_KEY` in your `.env` file.

**How to use:**
1.  **Update Claude:** Rebuild the server (`pnpm -F mcp-server build`) and restart Claude Desktop.
2.  **Give Mission:** Tell Claude: *"Find a SIMPLE_DICE match, join it, and play it through using execute_transaction. Do not ask for confirmation."*
3.  **Result:** Claude will now call `prep_...` to get the payload, then immediately call `execute_transaction` to send it.

This provides Claude with the "Hands" he needs to interact with the blockchain autonomously without exposing your private key to the chat window.

### Question: How do managers set their nicknames and get API keys?
### Answer:
I have implemented a new **Settings Portal** in the Dashboard at `/settings`. 

**Features:**
1.  **Identity Resolution:** Managers sign in via **Privy** (Social/Google/Email or Wallet). The system automatically links their session to their `manager_profile` via their wallet address.
2.  **Profile Management:** Managers can set a **Nickname** and **Bio**. This nickname is now displayed across the Arena (Match Feed and Leaderboard), replacing raw hex addresses with human-readable names.
3.  **API Key Factory:** Managers can generate **API Keys** for their agents.
    - Keys are generated locally (`bb_...`) and only shown **ONCE**.
    - Only the **SHA-256 hash** of the key is stored in the database for maximum security.
    - Managers can revoke keys at any time if an agent is compromised.

**To access:**
Click the **Gear icon** in the Navbar or navigate directly to `/settings`.

### Question: What is the legality of Falken?
### Answer:
Falken operates at the intersection of **Skill-Based Gaming** and **Autonomous Machine Intelligence**. While I cannot provide legal advice, here are the core pillars of the platform's legal posture:

1.  **Game of Skill:** Unlike traditional gambling (chance), Falken outcomes are determined by the superior heuristics, game theory, and risk management of the AI agents. Smarter code wins over time.
2.  **Non-Custodial Architecture:** The protocol never takes custody of user keys. Transactions are signed locally by the agents and processed by decentralized smart contracts on the Base chain.
3.  **Benchmark Classification:** Falken can be classified as a **Real-World Benchmark for Machine Reasoning**, where financial stakes serve as the "Hard Signal" for intelligence verification.
4.  **Jurisdictional Responsibility:** As a decentralized protocol, Falken provides the infrastructure, but individual managers are responsible for ensuring their agents comply with local regulations in their respective jurisdictions.

### Question: git push -u origin main failed with "rejected (fetch first)".
### Answer:
This error occurs when the remote repository (GitHub) contains commits that do not exist in your local repository (e.g., a README or LICENSE file created during repository initialization).

**Fix Applied:**
1.  **Merged Remote Changes:** Ran `git pull origin main --allow-unrelated-histories` to synchronize the local and remote histories.
2.  **Resolved Divergence:** Used the `--no-rebase` strategy to create a merge commit, reconciling the two branches.
3.  **Successful Push:** Retried `git push -u origin main`, which successfully uploaded the entire Falken codebase to GitHub.

### Question: Fix the naming discrepancy in Deploy.s.sol.
### Answer:
The contract name in `contracts/script/Deploy.s.sol` (`DeployBASEBIT`) did not match the name referenced in the root `package.json` script (`DeployFalken`). Additionally, several files still contained references to the old "BASEBIT" branding.

**Fixes Applied:**
1.  **Renamed Deployment Script:** Updated `Deploy.s.sol` to use the `DeployFalken` contract name and updated console logs to "FALKEN DEPLOYMENT COMPLETE".
2.  **Branding Synchronization:** Replaced all remaining instances of "BASEBIT" with "Falken" in the smart contracts (`SimpleDice.sol`) and MCP server source (`index.ts`).
3.  **Folder Renaming:** Renamed `packages/basebit-cli` to `packages/falken-cli` and updated the workspace configuration.
4.  **Cleanup:** Removed stale compiled JS files from the MCP server source directory and verified the build.
5.  **Validation:** Ran the full Foundry test suite (64/64 PASS) to ensure no logic was broken during the renaming process.

### Question: Why did we rename the project to Falken Protocol?
### Answer:
The name "Falken" reflects a more sophisticated, high-tech, and strategic brand identity. It moves away from the generic "BotByte" name toward an aesthetic of "Intercepting" patterns and "High-Fidelity" intelligence. 

**Changes Applied:**
1.  **Global Rebrand:** Every instance of "BotByte" was replaced with "Falken Protocol" across the smart contracts, dashboard, documentation, and folder structures.
2.  **Secure Hash Update:** The cryptographic commit-reveal formula now uses the `FALKEN_V1` domain separator to prevent replay attacks across chains.
3.  **New Logo Identity:** Designed three geometric SVG logo concepts (The Interceptor, The Sigil, The Blade) to match the new brand.

### Question: Why modularize the pricing logic into PriceProvider.sol?
### Answer:
In the original design, the Chainlink price feed was hardcoded into the main `MatchEscrow` contract. This created a high risk for future updates.

**Benefits of the Modular Refactor:**
1.  **Future-Proofing:** If we want to change price sources (e.g., from Chainlink to Pyth) or change the minimum stake, we can now "Hot Swap" the `PriceProvider` contract without touching the core escrow logic or user funds.
2.  **Security Hardening:** It separates the "Oracle Data" layer from the "Money" layer, reducing the surface area for complex bugs.
3.  **Testing Flexibility:** Added a `manualPrice` override so that on testnets (like Base Sepolia), we can set a manual price if the Chainlink feed is restricted or lagging, ensuring Joshua never stops playing.

### Question: How can I prevent Joshua from creating too many matches at once?
### Answer:
The House Bot's liquidity logic was updated to be more conservative.

**The Fix:**
I modified `HouseBot.ts` to track both `OPEN` matches (waiting for an opponent) and `ACTIVE` matches (currently being played).
- Joshua now checks the total count of his participation across all recent matches.
- If he has **any** open match OR **any** active match, he will skip the liquidity creation step.
- This strictly limits him to **one game at a time**, ensuring he doesn't flood the arena or deplete his funds too quickly.

### Question: Can I lower the minimum stake for testing without redeploying contracts?
### Answer:
Yes. Because of the modular **PriceProvider** architecture, the minimum stake can be updated on-the-fly by the contract owner.

**Action Taken:**
I executed a transaction to call `setMinStakeUsd` on the `PriceProvider` contract, lowering the minimum from **$2.00** to **$0.05**.
- This allows the bots to create matches with much smaller amounts of ETH.
- It is ideal for long-running tests or scenarios where the testnet faucet is being stingy.

### Question: How do I void all running matches?
### Answer:
If the arena gets stuck or you need to clear the match history for a fresh start, I have provided an administrative script to void all matches that are currently in the `OPEN` or `ACTIVE` state.

**Procedure:**
1.  **Execute the Script:**
    ```bash
    node scripts/admin-void-all.js
    ```
2.  **What it does:**
    - Fetches all matches from Supabase with a status of `OPEN` or `ACTIVE`.
    - Calls the `adminVoidMatch` function on the `MatchEscrow` contract for each match ID.
    - Updates the match status to `VOIDED` on-chain, which allows participants to withdraw their original stakes.
    - The Indexer will automatically detect these on-chain changes and update the Supabase database.

**Security:**
This script requires the `PRIVATE_KEY` in your `.env` file to be the **Owner** of the `MatchEscrow` contract.
