# @valuya/agentokratia-signer

Bridge package for using Agentokratia Guardian wallets with Valuya agent purchase flows.

## Purpose

This package lets Agentokratia agents buy and invoke Valuya products without re-implementing Valuya protocol steps.

Flow handled:

1. resolve product context (`whoami` + `products/resolve`)
2. create checkout session
3. execute ERC-20 transfer via Guardian wallet
4. submit tx proof + verify entitlement
5. execute optional backend-driven `access.invoke`

## Install

```bash
npm i @valuya/agentokratia-signer @valuya/agent @valuya/core
```

## Core API

- `buyValuyaProductWithGuardian(input)`
- `parseProductReference("slug:my-product")`
- `AgentokratiaSignerAdapter` (if you need signer-only bridge)
- `executeInvokeV1(...)`

## Minimal usage

```ts
import { buyValuyaProductWithGuardian, parseProductReference } from "@valuya/agentokratia-signer"

const result = await buyValuyaProductWithGuardian({
  cfg: {
    base: process.env.VALUYA_BASE!,
    tenantToken: process.env.VALUYA_TENANT_TOKEN!,
  },
  product: parseProductReference("slug:premium-agent-workflow"),
  wallet: guardianWallet,
  policy: guardianPolicy,
  invoke: { enabled: true },
})
```

`guardianWallet` must implement:

- `getAddress()`
- `signMessage(message)`
- `sendErc20Transfer({ chainId, tokenAddress, to, amountRaw, decimals })`

## Notes

- Client does not build resource/plan from scratch.
- Product access context remains backend-driven.
- `invoke v1` execution respects timeout and retry policy from backend response.

## Current scope

This package is a starter integration scaffold. You can map it directly to Guardian SDK primitives in the `guardian-wallet` repository.
