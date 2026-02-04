RFC: Valuya Guard v2

Status: Draft → Stable Candidate
Author: Valuya
Version: v2.0
Last updated: 2026-02-04

1. Purpose

Valuya Guard v2 defines a headless authorization & payment protocol that allows:

Humans and agents to access protected resources

Payments to be settled on-chain

Entitlements to be enforced without UI coupling

Guard v2 is designed to be embedded in:

APIs

Bots

Serverless functions

Autonomous agents

2. Core Concepts
   2.1 Subject

A Subject represents the beneficiary of access.

Canonical format (MANDATORY):

<type>:<id>

Examples:

user:526

anon:telegram_123456

agent:my-bot-v1

org:acme

Transport:

X-Valuya-Subject: <type>:<id>

2.2 Resource

A Resource is a stable identifier for what is being protected.

Examples:

api:path:/v1/generate

telegram:bot:premium_chat

discord:server:123456:role:premium

fastapi:route:/predict

Resources MUST be deterministic and stable.

2.3 Plan

A Plan defines the entitlement tier.

Examples:

free

pro

enterprise

Plans are opaque strings to Guard — semantics are product-defined.

2.4 Mandate

A Mandate is the on-chain-backed entitlement created after payment.

Uniqueness constraint:

(tenant_id, subject_type, subject_id, resource, plan, product_id)

Mandates are idempotent and time-bound.

3. Guard v2 Protocol Flow
   3.1 Entitlement Check (HEADLESS)

Endpoint

POST /api/v2/entitlements/check

Headers

Authorization: Bearer <TENANT_TOKEN>
X-Valuya-Subject: <type>:<id>
Content-Type: application/json

Body

{
"resource": "telegram:bot:premium_chat",
"plan": "pro"
}

3.2 Responses
✅ Authorized
{
"authorized": true,
"mandate_id": 42
}

💳 Payment Required
{
"authorized": false,
"checkout_required": true,
"session_id": "cs_xxx",
"payment": {
"method": "onchain",
"chain_id": 8453,
"token": "USDC",
"to_address": "0x...",
"amount_raw": "9900000",
"decimals": 6,
"token_address": "0x..."
}
}

3.3 Agent Payment Submission

Endpoint

POST /api/v2/agent/sessions/{sessionId}/tx

Body

{
"tx_hash": "0xabc...",
"from_address": "0xagentwallet",
"signature": "0xsigned_proof"
}

3.4 Verification (Agent-only, No UI)

Endpoint

POST /api/v2/agent/sessions/{sessionId}/verify

Body

{
"from_address": "0xagentwallet"
}

Response

{
"ok": true,
"state": "confirmed",
"mandate_id": 123
}

4. Security Model
   4.1 Agent Identity

Agents MUST:

Control the wallet submitting payment

Sign a proof over (session_id, tx_hash, resource)

Be allowlisted per (tenant, subject)

This guarantees:

Non-repudiation

Replay protection

No spoofing of subjects

4.2 Trust Boundaries
Component Trust Level
Guard backend Trusted
Agent wallet Cryptographically verified
Adapter (bot/API) Untrusted
Subject identifier User-defined 5. Adapter Implementation Guide
5.1 Telegram Bot Adapter
Subject Strategy
subject = {
type: "anon",
id: `telegram_${chat.id}`
}

Resource Strategy
resource = "telegram:bot:premium_chat"

Flow

User sends /premium

Bot calls Guard entitlements/check

If unauthorized:

Reply with payment instructions

Agent wallet pays

Bot verifies session

Access granted (e.g. unlock commands)

Example Guard Call (Node.js)
await checkEntitlement({
baseUrl,
tenanttoken,
subject,
resource,
plan: "pro",
})

5.2 Discord Bot Adapter
Subject Strategy
subject = {
type: "anon",
id: `discord_${user.id}`
}

Resource Strategy
resource = `discord:server:${guild.id}:role:premium`

Enforcement

Grant Discord role after mandate

Periodically re-check mandate validity

5.3 FastAPI Adapter
Subject Strategy
subject = {
"type": "user",
"id": str(current_user.id)
}

Resource Strategy
resource = f"fastapi:route:{request.url.path}"

Middleware Example
@app.middleware("http")
async def guard_middleware(request: Request, call_next):
subject = resolve_subject(request)
res = guard_check(subject, resource, plan="pro")
if not res.authorized:
raise HTTPException(402, "Payment required")
return await call_next(request)
