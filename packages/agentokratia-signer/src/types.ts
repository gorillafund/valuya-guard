import type { PaymentInstruction } from "@valuya/core"
import type { ProductResolveInput, AccessInvokeV1 } from "@valuya/agent"

export type GuardianErc20TransferInput = {
  chainId: number
  tokenAddress: string
  to: string
  amountRaw: string
  decimals?: number
}

export type GuardianTxResult = {
  txHash: string
}

/**
 * Minimal wallet surface needed by Valuya purchase flows.
 *
 * Implement this by wrapping Agentokratia Guardian wallet SDK methods.
 */
export type GuardianWalletLike = {
  getAddress(): Promise<string>
  signMessage(message: string): Promise<string>
  sendErc20Transfer(input: GuardianErc20TransferInput): Promise<GuardianTxResult>
}

export type GuardianPolicyLike = {
  checkPayment?(input: GuardianErc20TransferInput): Promise<void>
}

export type AgentokratiaValuyaConfig = {
  base: string
  tenantToken: string
  pollIntervalMs?: number
  pollTimeoutMs?: number
}

export type BuyWithGuardianInput = {
  cfg: AgentokratiaValuyaConfig
  product: ProductResolveInput
  wallet: GuardianWalletLike
  policy?: GuardianPolicyLike
  invoke?: {
    enabled?: boolean
    headers?: Record<string, string>
  }
}

export type NormalizedInvokeResult = {
  attempted: boolean
  status?: number
  body?: unknown
  latency_ms?: number
  retry_count?: number
  error?: string
}

export type BuyWithGuardianResult = {
  ok: true
  product?: {
    id?: number | string
    slug?: string | null
    plan?: string | null
  } | null
  context: {
    subject: { type: string; id: string }
    principal: { type: string; id: string }
    resource: string
    plan: string
  }
  session_id: string
  tx_hash: string
  verify: unknown
  invoke: NormalizedInvokeResult
}

export type InvokeExecutionOptions = {
  invoke: AccessInvokeV1
  allowedRuntimeHeaders?: Record<string, string>
}

export type RetryPolicyNormalized = {
  maxAttempts: number
  backoffMs: number[]
}

export function paymentToTransferInput(payment: Extract<PaymentInstruction, { method: "onchain" }>): GuardianErc20TransferInput {
  return {
    chainId: payment.chain_id,
    tokenAddress: payment.token_address,
    to: payment.to_address,
    amountRaw: payment.amount_raw,
    decimals: payment.decimals,
  }
}
