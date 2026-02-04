# Valuya Guard RFC v1

**Title:** Valuya Guard – Payment-Driven Authorization Protocol  
**Status:** Draft (Target: Final v1.0)  
**Authors:** Valuya  
**Last updated:** 2026-01-28

---

## 1. Abstract

Valuya Guard is a universal authorization protocol that unifies **payment and access control**
into a single deterministic state transition.

Instead of treating payment as a downstream business concern, Valuya Guard treats **payment as an
authorization primitive**.

Access is granted **if and only if** a valid **Mandate** exists for a given **Subject** and
**Resource**.

The protocol is infrastructure-agnostic, identity-agnostic, and works for:

- APIs
- Websites
- Files
- Agents
- AI systems
- Physical locations
- Spatial coordinates

---

## 2. Motivation

Modern systems split concerns across multiple layers:

- Authentication (Who are you?)
- Authorization (What may you access?)
- Payment (Did you pay?)

This separation causes:

- duplicated logic
- security gaps
- poor automation support
- fragile integrations

Valuya Guard collapses these concerns into a **single enforceable primitive**:  
**the Mandate**.

---

## 3. Core Concepts

### 3.1 Resource (Canonical)

A Resource represents anything that can be protected and monetized.

Canonical format:

# Valuya Guard RFC v1

**Title:** Valuya Guard – Payment-Driven Authorization Protocol  
**Status:** Draft (Target: Final v1.0)  
**Authors:** Valuya  
**Last updated:** 2026-01-28

---

## 1. Abstract

Valuya Guard is a universal authorization protocol that unifies **payment and access control**
into a single deterministic state transition.

Instead of treating payment as a downstream business concern, Valuya Guard treats **payment as an
authorization primitive**.

Access is granted **if and only if** a valid **Mandate** exists for a given **Subject** and
**Resource**.

The protocol is infrastructure-agnostic, identity-agnostic, and works for:

- APIs
- Websites
- Files
- Agents
- AI systems
- Physical locations
- Spatial coordinates

---

## 2. Motivation

Modern systems split concerns across multiple layers:

- Authentication (Who are you?)
- Authorization (What may you access?)
- Payment (Did you pay?)

This separation causes:

- duplicated logic
- security gaps
- poor automation support
- fragile integrations

Valuya Guard collapses these concerns into a **single enforceable primitive**:  
**the Mandate**.

---

## 3. Core Concepts

### 3.1 Resource (Canonical)

A Resource represents anything that can be protected and monetized.

Canonical format:

# Valuya Guard RFC v1

**Title:** Valuya Guard – Payment-Driven Authorization Protocol  
**Status:** Draft (Target: Final v1.0)  
**Authors:** Valuya  
**Last updated:** 2026-01-28

---

## 1. Abstract

Valuya Guard is a universal authorization protocol that unifies **payment and access control**
into a single deterministic state transition.

Instead of treating payment as a downstream business concern, Valuya Guard treats **payment as an
authorization primitive**.

Access is granted **if and only if** a valid **Mandate** exists for a given **Subject** and
**Resource**.

The protocol is infrastructure-agnostic, identity-agnostic, and works for:

- APIs
- Websites
- Files
- Agents
- AI systems
- Physical locations
- Spatial coordinates

---

## 2. Motivation

Modern systems split concerns across multiple layers:

- Authentication (Who are you?)
- Authorization (What may you access?)
- Payment (Did you pay?)

This separation causes:

- duplicated logic
- security gaps
- poor automation support
- fragile integrations

Valuya Guard collapses these concerns into a **single enforceable primitive**:  
**the Mandate**.

---

## 3. Core Concepts

### 3.1 Resource (Canonical)

A Resource represents anything that can be protected and monetized.

Canonical format:

# Valuya Guard RFC v1

**Title:** Valuya Guard – Payment-Driven Authorization Protocol  
**Status:** Draft (Target: Final v1.0)  
**Authors:** Valuya  
**Last updated:** 2026-01-28

---

## 1. Abstract

Valuya Guard is a universal authorization protocol that unifies **payment and access control**
into a single deterministic state transition.

Instead of treating payment as a downstream business concern, Valuya Guard treats **payment as an
authorization primitive**.

Access is granted **if and only if** a valid **Mandate** exists for a given **Subject** and
**Resource**.

The protocol is infrastructure-agnostic, identity-agnostic, and works for:

- APIs
- Websites
- Files
- Agents
- AI systems
- Physical locations
- Spatial coordinates

---

## 2. Motivation

Modern systems split concerns across multiple layers:

- Authentication (Who are you?)
- Authorization (What may you access?)
- Payment (Did you pay?)

This separation causes:

- duplicated logic
- security gaps
- poor automation support
- fragile integrations

Valuya Guard collapses these concerns into a **single enforceable primitive**:  
**the Mandate**.

---

## 3. Core Concepts

### 3.1 Resource (Canonical)

A Resource represents anything that can be protected and monetized.

Canonical format:

# Valuya Guard RFC v1

**Title:** Valuya Guard – Payment-Driven Authorization Protocol  
**Status:** Draft (Target: Final v1.0)  
**Authors:** Valuya  
**Last updated:** 2026-01-28

---

## 1. Abstract

Valuya Guard is a universal authorization protocol that unifies **payment and access control**
into a single deterministic state transition.

Instead of treating payment as a downstream business concern, Valuya Guard treats **payment as an
authorization primitive**.

Access is granted **if and only if** a valid **Mandate** exists for a given **Subject** and
**Resource**.

The protocol is infrastructure-agnostic, identity-agnostic, and works for:

- APIs
- Websites
- Files
- Agents
- AI systems
- Physical locations
- Spatial coordinates

---

## 2. Motivation

Modern systems split concerns across multiple layers:

- Authentication (Who are you?)
- Authorization (What may you access?)
- Payment (Did you pay?)

This separation causes:

- duplicated logic
- security gaps
- poor automation support
- fragile integrations

Valuya Guard collapses these concerns into a **single enforceable primitive**:  
**the Mandate**.

---

## 3. Core Concepts

### 3.1 Resource (Canonical)

A Resource represents anything that can be protected and monetized.

Canonical format:

<namespace>:<type>:<identifier>

Examples:

http:route:GET:/api/v1/data
wp:path:/premium/
file:download:/reports/q4.pdf
superworld:geo:52.5200 13.4050:radius:30
ai:model:trading-agent-v2
telegram:group:-100112312321

Rules:

- Deterministic
- Human-readable
- Infrastructure-independent
- Trailing slashes preserved where applicable

---

### 3.2 Subject

Subjects are entities requesting access.

Canonical form:

<subject_type>:<subject_id>

Examples:

anon:uuid
user:privy_abc123
agent:ci_runner_42
wallet:0xabc123213...

Valuya Guard does not enforce a specific identity provider.

---

### 3.3 Mandate

A Mandate is a verifiable entitlement stating that:

> A Subject is allowed to access a Resource under defined conditions.

Mandates may define:

- duration
- plan
- expiration
- revocation
- scope

Mandates are the **single source of truth** for authorization.

---

## 4. Protocol Flow

### 4.1 Request Lifecycle

Client -> Guard -> Decision -> Origin

1. Resolve Subject
2. Resolve Resource
3. Evaluate required plan
4. Check entitlement

---

### 4.2 Allow

If a valid mandate exists:

- Request is forwarded
- Response is unchanged
- Optional observability headers MAY be added

---

### 4.3 Deny (Payment Required)

If no mandate exists:

- A checkout session is **always created**

#### API / Agent / Fetch

HTTP/1.1 402 Payment Required

1. Resolve Subject
2. Resolve Resource
3. Evaluate required plan
4. Check entitlement

---

### 4.2 Allow

If a valid mandate exists:

- Request is forwarded
- Response is unchanged
- Optional observability headers MAY be added

---

### 4.3 Deny (Payment Required)

If no mandate exists:

- A checkout session is **always created**

#### API / Agent / Fetch

302 Found
Location <paymnet_url>

---

### 4.4 State Transition

DENIED
payment
MANDATE CREATED
retry
ALLOWED

---

## 5. Backend Interfaces (v2)

### 5.1 Entitlements

`GET /api/v2/entitlements`

Returns whether a mandate is active.

---

### 5.2 Checkout Sessions

`POST /api/v2/checkout/sessions`

Creates a payment-bound session for a mandate.

---

### 5.3 Polling

`GET /api/v2/checkout/sessions/{session_id}`

Used by humans and agents alike.

---

## 6. Security Model

- No access without mandate
- Payment creation is idempotent
- Mandates are authoritative
- Clients cannot self-assert access

---

## 7. Why This Is New

Valuya Guard is not a payment system or a paywall.

It is an **authorization protocol where payment is a state transition**.

Once adopted, systems no longer ask:

> “Did the user pay?”

They only ask:

> **“Is there a mandate?”**

---

## 8. Roadmap

- v1.0: RFC lock, npm publish
- v1.1: Product-Creation API
- v1.2: Agent-native payments
- v2.0: On-chain mandate anchoring (optional)

---
