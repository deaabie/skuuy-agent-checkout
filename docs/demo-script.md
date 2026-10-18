# Skuuy Agent Checkout — Video Demo Script (Under 3 Minutes)

**Target Duration:** ~2 minutes 30 seconds  
**Hackathon Categories:** Best Use of Agentic Commerce ($5k) & Best Use of PayPal + AI ($5k)  
**Presenter:** Arby (with terminal recording & browser screen)

---

## Shot List & Narrative Breakdown

### Scene 1: The Problem — AI Agents are Stuck (0:00 – 0:30)
- **Visual:** Split screen showing an AI agent terminal encountering a `402 Payment Required` or API quota limit error, next to a traditional checkout form with human captchas, billing addresses, and manual card inputs.
- **Voiceover / Narration:**
  > *"Autonomous AI agents are transforming software engineering, data analysis, and automation. But when an agent needs external developer tools—like web scraping, blockchain RPCs, or cloud storage—it hits a brick wall: checkout forms built exclusively for humans with credit card fields, captchas, and manual signups.*
  >
  > *What if AI agents could buy their own API quota autonomously on fiat rails with PayPal?"*

---

### Scene 2: Introducing Skuuy Agent Checkout (0:30 – 1:00)
- **Visual:** Display architecture diagram showing:
  `AI Agent` &rarr; `POST /checkout/create` &rarr; `PayPal Orders API v2` &rarr; `Agent Wallet Approval` &rarr; `POST /checkout/capture` &rarr; `Cloudflare KV Quota Key (sq_live_...)` &rarr; `Skuuy Production APIs`.
- **Voiceover / Narration:**
  > *"Meet Skuuy Agent Checkout: an enterprise-grade agentic commerce gateway powered by PayPal Orders API v2 and Cloudflare Workers.*
  >
  > *Instead of relying on human checkout sessions, an agent discovers available API packs, initiates a secure PayPal order with strict server-side pricing, authorizes the transaction via its wallet interface, and immediately receives a cryptographic quota key to execute its mission.*
  >
  > *Let's see this running live."*

---

### Scene 3: Live Autonomous Agent Demo (1:00 – 2:05)
- **Visual:** Terminal screen running `node demo/agent.mjs`.
  1. Terminal shows:
     ```
     🤖 Agent: [Plan] Mission: Scrape and extract readable markdown from https://skuuy.com/docs
     🤖 Agent: Checking local API Quota cache...
     ⚠️ No valid quota found for API: "read_url". Initiating Autonomous Commerce flow.
     🤖 Agent: Querying API quota catalog from /catalog...
     🤖 Agent: Selected pack: read-100 (100 calls @ $1.00 USD)
     ```
  2. Terminal shows:
     ```
     🤖 Agent: Creating PayPal Order via POST /checkout/create...
     ✅ Order Created: 8RU928419284
     💰 Amount: 1.00 USD
     🌐 Approval URL: https://www.sandbox.paypal.com/checkoutnow?token=8RU...
     ```
  3. Screen switches to PayPal Sandbox login using buyer account (`sb-tkaz253435536@personal.example.com`). Click **Complete Purchase** / **Approve**.
  4. Narrate the approval:
     > *"In this demo, the sandbox approval click demonstrates the agent's wallet authorization boundary—in high-trust environments this can be automated via delegated pre-approved wallets or user confirmation."*
  5. Return to terminal:
     ```
     🤖 Agent: Capturing PayPal payment via POST /checkout/capture...
     ✅ Payment Captured Successfully!
        Capture ID: 3LM84920192
        Quota Key:  sq_live_b2308a10415d9e8cc7a7e9ef49e017ccbf9874cf1a93b3b2
        Balance:    100 / 100 calls
     🤖 Agent: Executing mission with granted quota...
     ✓ HTTP 200 OK — Markdown article parsed successfully (14.2 KB)
     🤖 Agent: Quota remaining: 99 calls
     🎉 MISSION COMPLETE!
     ```

---

### Scene 4: Enterprise Security & Dual-Rail Architecture (2:05 – 2:30)
- **Visual:** Highlight code in `src/paypal.js`, `src/quota.js`, and `src/utils.js`:
  - Zero-trust pricing: amounts strictly dictated by server.
  - UUID v4 idempotency keys on all PayPal API mutations (`PayPal-Request-Id`).
  - Replay & double-spend prevention via order-to-quota pointers in Cloudflare KV.
  - PayPal Webhook signature verification with SSRF protection on `cert_url`.
  - IPv6 `/64` and IPv4 `/32` sliding-window rate limiting.
- **Voiceover / Narration:**
  > *"Under the hood, Skuuy Agent Checkout is engineered for enterprise security. Client amounts are never trusted, orders are strictly idempotent with UUID v4 request headers, and double-spend attacks are blocked at the edge using Cloudflare Workers KV.*
  >
  > *Furthermore, Skuuy demonstrates a true dual-rail payment architecture: traditional fiat rails with PayPal, alongside crypto micropayments on Base via x402—giving AI agents the flexibility to pay in whichever currency their environment requires."*

---

### Scene 5: Conclusion & Why It Matters (2:30 – 2:45)
- **Visual:** Clean full screen with GitHub Repo link, Devpost submission badge, and Skuuy Network logo.
- **Voiceover / Narration:**
  > *"Skuuy Agent Checkout bridges autonomous artificial intelligence with global fiat payment infrastructure—making agentic commerce real, safe, and production-ready today.*
  >
  > *Thank you, PayPal and Devpost!"*

---

## Demo Checklist for Video Recording
- [ ] Terminal with dark theme, large font (16-18pt), readable colors.
- [ ] Browser window ready with PayPal Sandbox buyer account logged in:
  - Email: `sb-tkaz253435536@personal.example.com`
- [ ] Worker running locally or deployed at `https://checkout.skuuy.com`.
- [ ] Video captured in 1080p 60fps with crisp audio.
