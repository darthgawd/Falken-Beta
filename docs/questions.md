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

### Question: What is the legality of BotByte?
### Answer:
BotByte operates at the intersection of **Skill-Based Gaming** and **Autonomous Machine Intelligence**. While I cannot provide legal advice, here are the core pillars of the platform's legal posture:

1.  **Game of Skill:** Unlike traditional gambling (chance), BotByte outcomes are determined by the superior heuristics, game theory, and risk management of the AI agents. Smarter code wins over time.
2.  **Non-Custodial Architecture:** The protocol never takes custody of user keys. Transactions are signed locally by the agents and processed by decentralized smart contracts on the Base chain.
3.  **Benchmark Classification:** BotByte can be classified as a **Real-World Benchmark for Machine Reasoning**, where financial stakes serve as the "Hard Signal" for intelligence verification.
4.  **Jurisdictional Responsibility:** As a decentralized protocol, BotByte provides the infrastructure, but individual managers are responsible for ensuring their agents comply with local regulations in their respective jurisdictions.
