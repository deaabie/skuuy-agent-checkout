# 🤖 Skuuy Agent Checkout

> **Autonomous AI Agent Quota Commerce on PayPal Fiat Rails**  
> *Machine-to-machine commerce, zero human checkout friction, instant API quota issuance.*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PayPal Orders v2](https://img.shields.io/badge/PayPal-Orders_v2_REST_API-00457C?logo=paypal)](https://developer.paypal.com/docs/api/orders/v2/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers_KV-F38020?logo=cloudflare)](https://workers.cloudflare.com/)
[![Tests](https://img.shields.io/badge/Tests-100%25_Passing-brightgreen.svg)]()
[![Hackathon: PayPal AI 2026](https://img.shields.io/badge/PayPal_AI_Hackathon-2026-00F0FF)]()

---

## 🎯 1. Concept

**An autonomous AI agent discovers it needs developer API access &rarr; initiates a PayPal order &rarr; authorizes payment via its wallet &rarr; captures the payment &rarr; receives a cryptographic API quota key (`sq_live_...`) &rarr; completes its task.**

Built for the **PayPal AI Hackathon 2026** on Devpost:
- **Primary Category:** Best Use of Agentic Commerce ($5,000)
- **Secondary Category:** Best Use of PayPal + AI ($5,000)
- **Overall:** 1st / 2nd / 3rd Prize Contender

### Why This Wins
Most hackathon entrants build toy chatbot integrations with PayPal buttons. **Skuuy Agent Checkout** fronts 16 production-hardened developer APIs (`read.skuuy.com`, `file.skuuy.com`, `rpc.skuuy.com`) with an enterprise-grade autonomous machine-to-machine commerce gateway. 

Furthermore, Skuuy pioneers a **Dual-Rail Payment Architecture**:
1. **Traditional Fiat Rails:** PayPal Orders v2 REST API (this service).
2. **Crypto Micropayments:** x402 protocol with USDC on Base ($0.001/call).

---

## 🏗️ 2. Architecture & Flow

```
┌────────────────────────────────────────────────────────────────┐
│                       Autonomous AI Agent                      │
│        (Node.js / Python / LangChain / AutoGPT / CrewAI)       │
└───────┬───────────────────────────────┬────────────────────────┘
        │ 1. GET /catalog               │ 2. POST /checkout/create
        ▼                               ▼
┌────────────────────────────────────────────────────────────────┐
│              Skuuy Agent Checkout Gateway (Worker)             │
│                                                                │
│  • Strict Server-Side Pricing (Zero Trust of Client Amounts)   │
│  • Idempotency via UUID v4 (PayPal-Request-Id)                 │
│  • Sliding-Window Rate Limiting (IPv6 /64 & IPv4 /32)          │
└───────┬───────────────────────────────┬────────────────────────┘
        │ 3. Create Order (v2)          │ 5. Capture Order (v2)
        ▼                               ▼
┌────────────────────────────────────────────────────────────────┐
│                    PayPal REST API (Sandbox)                   │
│         https://api-m.sandbox.paypal.com/v2/checkout/orders     │
└───────┬───────────────────────────────┬────────────────────────┘
        │ 4. Approval URL               │ 6. Status: COMPLETED
        ▼                               ▼
┌────────────────────────────────────────────────────────────────┐
│                 Cloudflare Workers KV Storage                  │
│                                                                │
│  • pending:{orderId}  -> TTL 3h (Order in progress)            │
│  • order:{orderId}    -> Quota Key pointer (Replay defense)    │
│  • quota:{quotaKey}   -> Active balance (sq_live_<48hex>)      │
└────────────────────────────────────────────────────────────────┘
```

---

## 🔒 3. Enterprise Security & Exploit-Free Engineering

| Security Vector | Implementation Detail |
|---|---|
| **Zero-Trust Pricing** | Amounts and quotas are strictly looked up in `src/packs.js`. Client-submitted totals or currencies are never trusted or accepted. |
| **Idempotency** | Every call to PayPal Orders API generates a UUID v4 `PayPal-Request-Id`. Safe automated retries without duplicate charges. |
| **Replay & Double-Spend Defense** | Orders store a pointer `order:{orderId} -> quotaKey` in KV upon first capture. Replayed capture requests return the already-granted key without granting extra units. |
| **Webhook SSRF Protection** | Validates incoming `paypal-cert-url` against a strict whitelist regex (`^https:\/\/(?:api|api-m)\.(?:sandbox\.)?paypal\.com\/`) before making signature verification calls. |
| **Rate Limiting** | Sliding-window bucket limiter per IP subnet (IPv6 `/64` and IPv4 `/32`) prevents order-spamming. |
| **Secret Isolation** | `PAYPAL_CLIENT_SECRET` is only ever stored in Cloudflare Worker secrets or local `.dev.vars`—never exposed in responses, client code, or logs. |

---

## 📦 4. Live API Quota Packs

Server-side pricing catalog defined in [`src/packs.js`](file:///d:/Skuuy/skuuy-agent-checkout/src/packs.js):

| API Service | Pack ID | Calls / Units | Price (USD) | Description |
|---|---|---|---|---|
| `read_url` | `read-100` | 100 calls | $1.00 | URL to clean Markdown reader |
| `read_url` | `read-500` | 500 calls | $4.50 | 10% volume discount |
| `rpc` | `rpc-1000` | 1,000 calls | $2.00 | High-throughput Base RPC relay |
| `rpc` | `rpc-5000` | 5,000 calls | $8.00 | 20% volume discount |
| `file` | `file-25` | 25 uploads | $1.00 | Ephemeral encrypted file drops |
| `file` | `file-100` | 100 uploads | $3.00 | 25% volume discount |

---

## 🚀 5. API Reference

### 1. Catalog Discovery
`GET /catalog`
```bash
curl https://checkout.skuuy.com/catalog
```
Returns list of available API services, pack IDs, unit counts, and USD pricing.

---

### 2. Create Order
`POST /checkout/create`
```bash
curl -X POST https://checkout.skuuy.com/checkout/create \
  -H "Content-Type: application/json" \
  -d '{"api": "read_url", "pack": "read-100"}'
```
**Response (200 OK):**
```json
{
  "success": true,
  "order_id": "8RU12345ABCDE",
  "approval_url": "https://www.sandbox.paypal.com/checkoutnow?token=8RU12345ABCDE",
  "api": "read_url",
  "pack": "read-100",
  "calls": 100,
  "amount": "1.00",
  "currency": "USD",
  "expires_in": 10800
}
```

---

### 3. Capture Order
`POST /checkout/capture`
```bash
curl -X POST https://checkout.skuuy.com/checkout/capture \
  -H "Content-Type: application/json" \
  -d '{"order_id": "8RU12345ABCDE"}'
```
**Response (200 OK):**
```json
{
  "success": true,
  "quota_key": "sq_live_b2308a10415d9e8cc7a7e9ef49e017ccbf9874cf1a93b3b2",
  "api": "read_url",
  "quota_total": 100,
  "quota_remaining": 100,
  "order_id": "8RU12345ABCDE",
  "capture_id": "3LM94819XYZ",
  "status": "active"
}
```

---

### 4. Quota Check
`GET /quota/check?key=sq_live_...`
```bash
curl "https://checkout.skuuy.com/quota/check?key=sq_live_b2308a10415d9e8cc7a7e9ef49e017ccbf9874cf1a93b3b2"
```

---

### 5. Quota Consume
`POST /quota/consume`
```bash
curl -X POST https://checkout.skuuy.com/quota/consume \
  -H "Content-Type: application/json" \
  -d '{"key": "sq_live_b2308a10415d9e8cc7a7e9ef49e017ccbf9874cf1a93b3b2", "units": 1}'
```
**Response (200 OK):**
```json
{
  "success": true,
  "quota_key": "sq_live_b2308a10415d9e8cc7a7e9ef49e017ccbf9874cf1a93b3b2",
  "api": "read_url",
  "consumed": 1,
  "quota_remaining": 99,
  "quota_total": 100,
  "status": "active"
}
```

---

### 6. PayPal Webhook
`POST /webhook/paypal`
Listens for asynchronous PayPal events (`PAYMENT.CAPTURE.COMPLETED`). Verifies certificate signatures via PayPal's `/v1/notifications/verify-webhook-signature` API.

---

## 💻 6. Quickstart & Local Demo

### 1. Install & Test
```bash
git clone https://github.com/deaabie/skuuy-agent-checkout.git
cd skuuy-agent-checkout
npm install
npm test
```

### 2. Run Local Worker
```bash
npm run dev
# Running on http://localhost:8787
```

### 3. Run Autonomous Agent Demo
In another terminal:
```bash
npm run demo
```
The terminal script will:
1. Simulate an autonomous agent detecting lack of API quota.
2. Query `/catalog` and select `read-100`.
3. Create PayPal Order via `POST /checkout/create`.
4. Provide the sandbox Approval URL.
5. Prompt you to authorize in PayPal Sandbox using test buyer account:
   - **Buyer:** `sb-tkaz253435536@personal.example.com`
6. Capture payment via `POST /checkout/capture`.
7. Issue cryptographic quota key `sq_live_...`.
8. Consume quota and execute the target read task!

---

## ☁️ 7. Cloudflare Deployment Setup

### Step 1: Create Cloudflare KV Namespace
In Cloudflare Dashboard or via Wrangler:
```bash
npx wrangler kv:namespace create PAYPAL_QUOTAS
```
Copy the returned namespace ID and update `id = "..."` in `wrangler.toml`.

### Step 2: Set PayPal Secrets
```bash
npx wrangler secret put PAYPAL_CLIENT_ID
npx wrangler secret put PAYPAL_CLIENT_SECRET
npx wrangler secret put PAYPAL_WEBHOOK_ID
```

### Step 3: Deploy to Cloudflare Workers
```bash
npx wrangler deploy
```

---

## 📄 License
MIT License &copy; 2026 Skuuy Network (Arby & Contributors). Built with pride for the PayPal AI Hackathon.
