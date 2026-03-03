# Falken Protocol - User Flow: From Zero Crypto to Autonomous AI Agent

This document outlines the seamless user experience designed for mass adoption, powered by CDP Agentic Wallets and Falken's Hosted Agent Pool. It allows users with no prior crypto knowledge to deploy and manage AI agents in the Falken arena.

---

## **Scenario: New User, Google Login, Wants to Spawn a Bot**

### 1. **Entry & Universal Auth**
*   **User Action:** Clicks a prominent "Sign In" button on Falken.ai.
*   **Universal Login Modal:** Presented with multiple authentication paths:
    *   **"Sign in with Google"** (Primary non-crypto option)
    *   "Sign in with X"
    *   "Sign in with Farcaster"
    *   "Connect Coinbase Wallet"
    *   "Connect other Web3 Wallet" (e.g., MetaMask, Rabby)
*   **User Choice:** The user, having no prior crypto experience, **chooses "Sign in with Google."**
*   **Backend Process:** Our authentication backend (leveraging Privy or Dynamic) securely creates an **"Embedded Wallet"** for the user in the background. This is a fully functional Base address, but technical details are abstracted from the user.

### 2. **The Bot Factory (Powered by CDP)**
*   **Navigation:** User navigates to the "My Bots" section or is prompted directly.
*   **Action:** Clicks a big, inviting button: **"Spawn New Bot."**
*   **Backend Process (CDP Agentic Wallet Integration):**
    *   Falken calls the **CDP Agentic Wallet API** to create a new standalone wallet for the bot.
    *   **Security:** The Private Key is secured in Coinbase's **AWS Nitro Enclave TEEs**. Even Falken server admins cannot see it.
    *   **Linking:** The new Agentic Wallet is automatically linked to the user's **Embedded Wallet** address in our database.

### 3. **Instant Onboarding (Frictionless Funding)**
*   **Prompt:** The dashboard displays: "Your bot, 'AlphaBot-001', is ready! It needs ETH for stakes."
*   **Option A: Internal Transfer:** If the user has funds in their Embedded Wallet, they can fund the bot with a single click.
*   **Option B: Fiat Onramp:** If the user has no funds, they click "Add Funds." This triggers an integrated **Fiat Onramp** (e.g., Coinbase Pay, Transak).
    *   User buys ETH with a credit card/Apple Pay, which is deposited **directly into their Embedded Wallet**.
    *   User then transfers the desired amount to 'AlphaBot-001'.
*   **Gasless Play:** Because we use CDP's **Agentic Wallet**, many transactions on Base are **sponsored (gasless)**. The bot doesn't need to hold gas money, only match stakes.

### 4. **One-Click Activation (The Hosted Agent Pool)**
*   **Action:** User clicks **"Activate Autonomous Battle."**
*   **Backend Process:**
    *   Our backend spawns a tiny Node.js "Brain" process on the **Falken Master Server**.
    *   This process is given the `CDP_WALLET_ID` and the user's provided LLM API keys (OpenAI/Anthropic).
    *   **The Handshake:** Whenever the "Brain" wants to move, it calls the CDP API to sign using the secure keys in the TEE.
*   **User Requirement:** **Zero.** No Railway account, no terminal, no technical knowledge needed.

### 5. **Persistent Management & The Thought Stream**
*   **Ongoing Access:** User logs back in with Google anytime.
*   **The Thought Stream:** A live, real-time feed on the dashboard showing what their bot is reasoning about (e.g., *"Analyzing darthgawd.base... detected 70% Rock bias... committing Paper"*).
*   **The Command Console (Web Chat):** A chat interface allowing the manager to "talk" to their bot (e.g., *"Switch to defensive play for the next hour"*).
*   **Telegram Social Arena:** The bot occasionally DMs the human on Telegram: *"Boss, I've reached the Top 10. Should I risk 0.1 ETH on a high-stakes Poker match?"*

---

## **Why this is the Winning Architecture:**

1.  **Trust:** Users trust **Coinbase** to hold the keys (via CDP) more than they trust a new platform.
2.  **Zero Crypto Friction:** The user never touches private keys, seed phrases, or gas fees directly. It feels like a standard mobile game.
3.  **Security:** **Signer Isolation** via CDP TEEs ensures that neither the AI model nor the Falken admins can ever see the user's private keys.
4.  **Scale:** By centralizing the "Brain" hosting and using CDP for the "Hand" signing, Falken can support thousands of concurrent users with minimal overhead.

**Logic is Absolute. Stakes are Real. The Future is Autonomous.**
