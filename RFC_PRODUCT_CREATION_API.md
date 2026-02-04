# Valuya Product Creation API

**Version:** v1  
**Status:** Draft

---

## 1. Purpose

The Product Creation API allows platforms to **programmatically define monetizable resources**
that Valuya Guard can enforce.

Products bind:

- a Resource
- a Plan
- a Price
- a Currency
- a Mandate Policy

This API is designed to be:

- simple
- automatable
- npm-friendly
- agent-compatible

---

## 2. Core Concept

A **Product** is the commercial representation of a Resource.

> Resources are protected by Guard.  
> Products describe how access is sold.

---

## 3. Create Product

### Endpoint

POST /api/v2/products

# Valuya Product Creation API

**Version:** v1  
**Status:** Draft

---

## 1. Purpose

The Product Creation API allows platforms to **programmatically define monetizable resources**
that Valuya Guard can enforce.

Products bind:

- a Resource
- a Plan
- a Price
- a Currency
- a Mandate Policy

This API is designed to be:

- simple
- automatable
- npm-friendly
- agent-compatible

---

## 2. Core Concept

A **Product** is the commercial representation of a Resource.

> Resources are protected by Guard.  
> Products describe how access is sold.

---

## 3. Create Product

### Endpoint

# Valuya Product Creation API

**Version:** v1  
**Status:** Draft

---

## 1. Purpose

The Product Creation API allows platforms to **programmatically define monetizable resources**
that Valuya Guard can enforce.

Products bind:

- a Resource
- a Plan
- a Price
- a Currency
- a Mandate Policy

This API is designed to be:

- simple
- automatable
- npm-friendly
- agent-compatible

---

## 2. Core Concept

A **Product** is the commercial representation of a Resource.

> Resources are protected by Guard.  
> Products describe how access is sold.

---

## 3. Create Product

### Endpoint

# Valuya Product Creation API

**Version:** v1  
**Status:** Draft

---

## 1. Purpose

The Product Creation API allows platforms to **programmatically define monetizable resources**
that Valuya Guard can enforce.

Products bind:

- a Resource
- a Plan
- a Price
- a Currency
- a Mandate Policy

This API is designed to be:

- simple
- automatable
- npm-friendly
- agent-compatible

---

## 2. Core Concept

A **Product** is the commercial representation of a Resource.

> Resources are protected by Guard.  
> Products describe how access is sold.

---

## 3. Create Product

### Endpoint

Semantics

- resource MUST be canonical
- plan is evaluated by Guard rules
- amount_cents is authorative
- billing.type may be:
  -- one_time
  -- subscription
  -- usage
- mandate.duration defines entitlement lifetime

### Response

{
"product_id": "prod_abc123",
"resource": "http:route:GET:/api/v1/data",
"plan": "pro",
"currency": "EUR",
"amount_cents": 9900,
"created_at": "2026-01-28T12:00:00Z"
}

### Update Product

PATCH /api/v2/products/{product_id}

Allowed Updates:

- price
- billing terms
- mandate duration

### List Products

GET /api/v2/products

### mpn SDK Interface (Draft)

import { createProduct } from "@valuya/guard"

await createProduct({
resource: "wp:path:/premium/article/",
plan: "pro",
price: {
amountCents: 9900,
currency: "EUR",
},
billing: "subscription",
})

### Design Guarantees

- Product creation is idempotent per (resource, plan)
- Products are immutable identifiers
- Pricing changes do not invalidate existing mandates

# Future Extensions

- geo-bound products
- wallet-bound products
- agent-only products
- time-boxed access passes
- physical access products (QR/NFC)
