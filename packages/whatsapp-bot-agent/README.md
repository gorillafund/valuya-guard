# @valuya/whatsapp-bot-agent

`@valuya/whatsapp-bot-agent` is a clean orchestration layer for a WhatsApp bot that talks to an agent and keeps Guard payment and Alfies checkout concerns outside the transport loop.

It is intended to replace the current monolithic `packages/whatsapp-bot/src/server.ts` shape with a structure where:

- WhatsApp transport handles Twilio webhook I/O
- link resolution stays in a dedicated Guard integration
- the agent decides what to do next
- tools execute concrete checkout and payment actions
- Alfies order dispatch remains a backend concern

## Suggested folder structure

```text
packages/whatsapp-bot-agent/
  src/
    app/
      WhatsAppBotAgentApp.ts
      WhatsAppBotAgentApp.test.ts
    domain/
      types.ts
    ports/
      AgentRuntime.ts
      AlfiesCheckoutPort.ts
      ConversationStore.ts
      LinkResolver.ts
      PaymentGateway.ts
      ToolRegistry.ts
    testing/
      InMemoryConversationStore.ts
      StaticToolRegistry.ts
    index.ts
  IMPLEMENTATION_PLAN.md
  package.json
  README.md
  tsconfig.json
```

## What this package owns

- inbound WhatsApp message orchestration
- linked-subject guard gate before agent execution
- conversation history handoff to the agent runtime
- tool execution loop
- final assistant reply assembly

## What this package does not own

- Twilio signature validation
- raw HTTP server setup
- Alfies API specifics
- Valuya marketplace order payload details
- delegated payment transport details

Those stay behind ports and can be implemented by adapters reusing code from:

- `packages/whatsapp-bot`
- `packages/whatsapp-channel-access`
- `packages/telegram-bot/examples/alfies-concierge`

## Current implementation

This package now provides:

- a compileable orchestration service: `WhatsAppBotAgentApp`
- explicit ports for agent runtime, Guard link resolution, tools, checkout, and payment
- real adapters for:
  - WhatsApp Guard link resolution
  - file-backed conversation persistence
  - Valuya entitlement / marketplace / delegated payment calls
  - backend Alfies order dispatch
- a ready-to-use `CommerceToolRegistry`
- in-memory testing helpers
- a basic test proving the tool-execution loop

The implementation is still intentionally incremental. The goal is to migrate the current bot safely by reusing existing integrations behind stable ports.

## Integration shape

Typical runtime composition:

1. Twilio webhook receives inbound message.
2. Transport calls `WhatsAppBotAgentApp.handleInboundMessage(...)`.
3. `LinkResolver` confirms the WhatsApp user is linked to a Valuya subject.
4. `ConversationStore` loads the conversation session.
5. `AgentRuntime` receives the session plus available tools.
6. `ToolRegistry` executes requested actions such as:
   - fetch cart
   - quote Alfies basket
   - create marketplace order
   - request delegated payment
   - create checkout link
   - dispatch Alfies order
7. Final assistant reply is returned to the transport.

## Reuse map from the current codebase

Recommended future adapters:

- `LinkResolver`
  - implemented by `GuardWhatsAppLinkResolverAdapter`
- `PaymentGateway`
  - implemented by `ValuyaPaymentGatewayAdapter`
- `AlfiesCheckoutPort`
  - implemented by `BackendAlfiesCheckoutAdapter`
- `ConversationStore`
  - implemented by `FileConversationStoreAdapter`

## Example composition

```ts
import {
  BackendAlfiesCheckoutAdapter,
  CommerceToolRegistry,
  FileConversationStoreAdapter,
  GuardWhatsAppLinkResolverAdapter,
  ValuyaPaymentGatewayAdapter,
  WhatsAppBotAgentApp,
} from "@valuya/whatsapp-bot-agent"

const paymentGateway = new ValuyaPaymentGatewayAdapter({
  baseUrl: process.env.VALUYA_BASE!,
  tenantToken: process.env.VALUYA_TENANT_TOKEN!,
  resource: process.env.VALUYA_ORDER_RESOURCE!,
  plan: process.env.VALUYA_PLAN || "standard",
  productId: Number(process.env.MARKETPLACE_PRODUCT_ID),
})

const alfiesCheckout = new BackendAlfiesCheckoutAdapter({
  baseUrl: process.env.VALUYA_BACKEND_BASE_URL!,
  token: process.env.VALUYA_BACKEND_TOKEN!,
  resource: process.env.VALUYA_ORDER_RESOURCE!,
  plan: process.env.VALUYA_PLAN || "standard",
})

const app = new WhatsAppBotAgentApp({
  agentRuntime,
  conversationStore: new FileConversationStoreAdapter(process.env.WHATSAPP_STATE_FILE!),
  linkResolver: new GuardWhatsAppLinkResolverAdapter({
    baseUrl: process.env.VALUYA_BASE!,
    tenantToken: process.env.VALUYA_TENANT_TOKEN!,
    channelAppId: process.env.WHATSAPP_CHANNEL_APP_ID || "whatsapp_main",
    stateFile: process.env.WHATSAPP_STATE_FILE!,
  }),
  toolRegistry: new CommerceToolRegistry({
    paymentGateway,
    alfiesCheckout,
    defaultResource: process.env.VALUYA_ORDER_RESOURCE!,
    defaultPlan: process.env.VALUYA_PLAN || "standard",
  }),
})
```

## Implementation plan

See [IMPLEMENTATION_PLAN.md](/home/colt/Software/valuya-guard/packages/whatsapp-bot-agent/IMPLEMENTATION_PLAN.md).

## Alfies paid fulfillment

See [ALFIES_ORDER_FULFILLMENT_DESIGN.md](/home/colt/Software/valuya-guard/packages/whatsapp-bot-agent/ALFIES_ORDER_FULFILLMENT_DESIGN.md) for the target design that turns a successfully paid Valuya checkout into a real Alfies storefront order with:

- basket sync
- delivery address
- shipping selection
- checkout preview
- post-payment order submit
