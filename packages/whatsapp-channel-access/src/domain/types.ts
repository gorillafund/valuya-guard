export type LogFn = (event: string, fields: Record<string, unknown>) => void

export type ChannelAccessState =
  | "trial_active"
  | "paid_active"
  | "expired_payment_required"
  | "inactive"

export type AccessState =
  | "not_linked"
  | ChannelAccessState
  | "guard_unavailable"

export type ChannelMode =
  | { kind: "human" }
  | { kind: "agent"; soulId: string }

export type SoulConfig = {
  id: number | string
  slug: string
  name: string
  version: number | string
  capabilities?: Record<string, unknown> | null
  tool_policy?: Record<string, unknown> | null
  memory_policy?: Record<string, unknown> | null
  compiled_prompt_artifacts?: Record<string, unknown> | null
}

export type ChannelRuntimeConfig = {
  mode: "human" | "agent"
  channel: string
  channel_kind: string
  provider: string | null
  channel_app_id?: string | null
  visit_url: string | null
  human_routing?: Record<string, unknown> | null
  agent_routing?: Record<string, unknown> | null
  fallback?: {
    allowed: boolean
    mode: "human"
  } | null
  soul: SoulConfig | null
}

export type ChannelAccessResolveRequest = {
  resource: string
  plan: string
  channel?: {
    kind?: string | null
    provider?: string | null
    channel_identifier?: string | null
    phone_number?: string | null
    bot_name?: string | null
    chat_id?: string | null
  } | null
}

export type ChannelAccessResolveResponse = {
  ok: boolean
  state: ChannelAccessState
  resource: string
  anchor_resource: string
  plan: string
  expires_at: string | null
  payment_url: string | null
  reason: string | null
  runtime_config: ChannelRuntimeConfig | null
  capabilities: {
    channel_access_version: string
    [key: string]: unknown
  }
}

export type LegacyEntitlementResponse = {
  active?: boolean
  reason?: string
  evaluated_plan?: string
  expires_at?: string | null
  payment_url?: string | null
  state?: string
  required?: Record<string, unknown> | null
}

export type SoulDefinition = {
  id: string
  name: string
  systemPrompt: string
  locale?: string
  memoryPolicy?: {
    keepRecentTurns: number
    summarizeAfterTurns: number
  }
  tools?: string[]
}

export type SoulMemoryTurn = {
  role: "user" | "assistant"
  content: string
  createdAt: string
}

export type SoulMemory = {
  recentTurns: SoulMemoryTurn[]
  summaries: string[]
  userProfile?: Record<string, unknown>
  updatedAt: string
}

export type WhatsAppLinkResolver = {
  ensureLinkedForPaymentAction(args: {
    whatsappUserId: string
    whatsappProfileName?: string
  }): Promise<
    | {
        allowed: true
        link: {
          valuya_protocol_subject_header?: string
        }
      }
    | {
        allowed: false
        code: string
        reply: string
      }
  >
}

export type ChannelMandateResolution = {
  state: ChannelAccessState
  resource: string
  anchorResource: string
  plan: string
  protocolSubjectHeader: string
  expiresAt?: string
  paymentUrl?: string | null
  channelUrl?: string | null
  reason?: string
  runtimeConfig?: ChannelRuntimeConfig | null
  capabilities?: {
    channel_access_version: string
    [key: string]: unknown
  }
  source: "channel_access_resolve" | "entitlements_fallback"
}

export type WhatsAppChannelAccessDecision =
  | {
      allowed: true
      state: "trial_active" | "paid_active"
      protocolSubjectHeader: string
      resource: string
      anchorResource: string
      plan: string
      expiresAt?: string
      channelUrl?: string | null
      runtimeConfig: ChannelRuntimeConfig | null
      capabilities: {
        channel_access_version: string
        [key: string]: unknown
      } | null
      source: "channel_access_resolve" | "entitlements_fallback"
    }
  | {
      allowed: false
      state: "not_linked" | "expired_payment_required" | "inactive" | "guard_unavailable"
      protocolSubjectHeader: string | null
      resource: string
      anchorResource: string
      plan: string
      reply: string
      expiresAt?: string
      paymentUrl?: string | null
      runtimeConfig: ChannelRuntimeConfig | null
      capabilities: {
        channel_access_version: string
        [key: string]: unknown
      } | null
      source: "channel_access_resolve" | "entitlements_fallback" | "linking"
    }

export type SoulResponse = {
  reply: string
  memory?: SoulMemory
  metadata?: Record<string, unknown>
}

export type WhatsAppChannelRuntimeResult =
  | {
      kind: "blocked"
      access: WhatsAppChannelAccessDecision & { allowed: false }
      reply: string
    }
  | {
      kind: "human"
      access: WhatsAppChannelAccessDecision & { allowed: true }
      protocolSubjectHeader: string
      reply: string
    }
  | {
      kind: "allowed"
      access: WhatsAppChannelAccessDecision & { allowed: true }
      protocolSubjectHeader: string
      reply: string
    }
  | {
      kind: "agent"
      access: WhatsAppChannelAccessDecision & { allowed: true }
      protocolSubjectHeader: string
      soulId: string
      reply: string
      metadata?: Record<string, unknown>
    }
  | {
      kind: "runtime_error"
      access: WhatsAppChannelAccessDecision & { allowed: true }
      protocolSubjectHeader: string
      error: "runtime_missing" | "agent_misconfigured"
      reply: string
    }
