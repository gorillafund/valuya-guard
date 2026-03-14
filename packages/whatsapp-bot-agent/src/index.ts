export { WhatsAppBotAgentApp } from "./app/WhatsAppBotAgentApp.js"

export type {
  AgentToolCall,
  AgentToolDefinition,
  AgentToolResult,
  AgentTurnResult,
  ConversationEntry,
  ConversationSession,
  GuardAccessDecision,
  LinkedSubject,
  WhatsAppAgentReply,
  WhatsAppInboundMessage,
} from "./domain/types.js"

export type { AgentRuntime } from "./ports/AgentRuntime.js"
export type { AlfiesCartLine, AlfiesCheckoutPort } from "./ports/AlfiesCheckoutPort.js"
export type { ActiveCartSnapshot, CartStatePort } from "./ports/CartStatePort.js"
export type { CatalogPort, ResolvedCatalogProduct } from "./ports/CatalogPort.js"
export type { ConversationStore } from "./ports/ConversationStore.js"
export type { CartMutationPort } from "./ports/CartMutationPort.js"
export type { LinkResolver } from "./ports/LinkResolver.js"
export type { PaymentGateway } from "./ports/PaymentGateway.js"
export type { ToolRegistry } from "./ports/ToolRegistry.js"
export type { ShoppingPlanner, ShoppingPlannerDecision } from "./runtime/ShoppingPlanner.js"

export { InMemoryConversationStore } from "./testing/InMemoryConversationStore.js"
export { StaticToolRegistry } from "./testing/StaticToolRegistry.js"
export { BackendAlfiesCheckoutAdapter } from "./adapters/BackendAlfiesCheckoutAdapter.js"
export { FileConversationStoreAdapter } from "./adapters/FileConversationStoreAdapter.js"
export { GuardWhatsAppLinkResolverAdapter } from "./adapters/GuardWhatsAppLinkResolverAdapter.js"
export { SharedStateCatalogPortAdapter } from "./adapters/SharedStateCatalogPortAdapter.js"
export { SharedStateCartPortAdapter } from "./adapters/SharedStateCartPortAdapter.js"
export { SharedStateCartMutationPortAdapter } from "./adapters/SharedStateCartMutationPortAdapter.js"
export { ValuyaPaymentGatewayAdapter } from "./adapters/ValuyaPaymentGatewayAdapter.js"
export { OpenAIShoppingPlanner } from "./runtime/OpenAIShoppingPlanner.js"
export { SimpleCheckoutAgentRuntime } from "./runtime/SimpleCheckoutAgentRuntime.js"
export { CommerceToolRegistry } from "./tools/CommerceToolRegistry.js"
