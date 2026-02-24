# Agentokratia x Valuya Integration Guide

This guide describes how Agentokratia Guardian wallet agents can buy and use Valuya products.

## Objective

Enable Agentokratia agents to:

1. discover/resolve a Valuya product
2. pay with Guardian wallet
3. verify entitlement
4. execute optional post-payment invoke endpoint

## Integration package

Use `@valuya/agentokratia-signer`.

It provides:

- signer bridge: `AgentokratiaSignerAdapter`
- one-call purchase flow: `buyValuyaProductWithGuardian(...)`
- invoke runner: `executeInvokeV1(...)`

## Required Guardian SDK mapping

Implement `GuardianWalletLike`:

- `getAddress(): Promise<string>`
- `signMessage(message: string): Promise<string>`
- `sendErc20Transfer({ chainId, tokenAddress, to, amountRaw, decimals }): Promise<{ txHash: string }>`

Optional policy preflight (`GuardianPolicyLike`):

- `checkPayment(...)`

## Protocol invariants preserved

- Client does not synthesize `resource`, `plan`, `subject`.
- Client consumes backend `products/resolve` outputs.
- Checkout proof flow remains unchanged.
- Invoke execution uses backend-provided `access.invoke` (v1 contract).

## Implementation steps in guardian-wallet repo

1. Add dependency: `@valuya/agentokratia-signer`.
2. Create `GuardianWalletLike` adapter around threshold signer.
3. Add command/action: `buy-valuya-product`.
4. Pass product ref (`id:`, `slug:`, `external:`) into `parseProductReference`.
5. Run `buyValuyaProductWithGuardian`.
6. Show normalized result in agent logs and UX.

## Suggested command UX

Input:

- product reference
- optional invoke toggle

Output:

- session id
- tx hash
- verify status
- invoke status/body

## Error handling matrix

Handle explicitly:

- `product_not_found`
- `invalid_product_ref`
- `principal_not_bound`
- policy rejection (`checkPayment` throw)
- timeout in invoke runner
- verify timeout/failure

## Observability

Log these keys end-to-end:

- `product_ref`
- `resource`
- `session_id`
- `tx_hash`
- `subject`
- `invoke.status`

## Example

See `examples/agentokratia-guardian-template/index.ts`.
