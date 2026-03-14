# WhatsApp Bot Agent Implementation Plan

## Goal

Move the WhatsApp bot to a cleaner architecture where the transport layer is thin and the agent interacts with Guard and Alfies through explicit tool boundaries.

## Phase 1: Establish the orchestration seam

Status: implemented.

Work:

- create `WhatsAppBotAgentApp`
- define ports for:
  - agent runtime
  - conversation store
  - link resolver
  - payment gateway
  - Alfies checkout
  - tool registry
- add tests for the tool loop and blocked-link path

Exit criteria:

- package builds and tests pass
- the orchestration contract is stable enough for adapters

## Phase 2: Wrap existing integrations behind ports

Work:

- add `WhatsAppLinkResolverAdapter` around `GuardWhatsAppLinkService`
- add `FileConversationStoreAdapter` around `FileStateStore` / `ConversationStateService`
- add `ValuyaPaymentGatewayAdapter` around:
  - marketplace order creation
  - delegated payment
  - checkout link creation
- add `AlfiesCheckoutAdapter` around pricing and dispatch

Status: partially implemented.

Implemented:

- `GuardWhatsAppLinkResolverAdapter`
- `FileConversationStoreAdapter`
- `ValuyaPaymentGatewayAdapter`
- `BackendAlfiesCheckoutAdapter`
- `CommerceToolRegistry`

Remaining:

- richer conversation persistence beyond `recentConversationHistory`
- optional adapter over the existing `ConversationStateService`
- marketplace-order link persistence parity with the old WhatsApp bot

Exit criteria:

- current Guard and Alfies flows can run without importing the old monolithic server

## Phase 3: Define the agent tool contract

Work:

- define canonical tool names, for example:
  - `cart.get_active`
  - `alfies.quote_cart`
  - `valuya.marketplace.create_order`
  - `valuya.payment.request_delegated`
  - `valuya.payment.create_checkout_link`
  - `alfies.order.dispatch`
- standardize input/output payloads
- add idempotency requirements to tool metadata

Exit criteria:

- the agent can call tools deterministically
- payment and checkout steps are observable and auditable

## Phase 4: Migrate WhatsApp webhook handling

Work:

- move Twilio webhook parsing and signature validation into a thin transport package or module
- replace direct business logic in `packages/whatsapp-bot/src/server.ts` with:
  - transport input parsing
  - `WhatsAppBotAgentApp.handleInboundMessage(...)`
  - outbound reply rendering

Exit criteria:

- webhook handler no longer owns payment or Alfies logic directly

## Phase 5: Migrate stateful shopping features

Work:

- move cart browsing, clarification, and product-selection logic into tools or supporting services
- keep conversation state serializable and tool-friendly
- retain analytics hooks for:
  - link resolution
  - tool execution
  - payment attempts
  - checkout fallbacks

Exit criteria:

- the old shopping/router path can be reduced or retired

## Phase 6: Production hardening

Work:

- add structured logs per tool call and payment stage
- add retry policy for Guard and Alfies network failures
- add contract tests for:
  - marketplace order creation
  - delegated payment fallback
  - linked-subject enforcement
  - duplicate webhook replay safety

Exit criteria:

- the new package is ready to sit behind the production WhatsApp transport

## Recommended migration order

1. keep the current WhatsApp bot running
2. build adapters in `@valuya/whatsapp-bot-agent`
3. run the new orchestration path in shadow mode for selected requests
4. compare logs and payment outcomes
5. switch the Twilio webhook to the new orchestration path
6. delete dead code from the monolithic server only after parity is proven
