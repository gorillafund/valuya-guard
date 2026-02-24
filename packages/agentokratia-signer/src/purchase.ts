import {
  parseProductRef,
  purchase,
  resolvePurchaseContext,
  type ProductResolveInput,
} from "@valuya/agent"
import type { PaymentInstruction } from "@valuya/core"
import { AgentokratiaSignerAdapter } from "./signer.js"
import { executeInvokeV1 } from "./invoke.js"
import type {
  BuyWithGuardianInput,
  BuyWithGuardianResult,
  GuardianErc20TransferInput,
  AgentokratiaValuyaConfig,
} from "./types.js"

export async function buyValuyaProductWithGuardian(input: BuyWithGuardianInput): Promise<BuyWithGuardianResult> {
  const cfg = toAgentConfig(input.cfg)

  const context = await resolvePurchaseContext({
    cfg,
    product: input.product,
  })

  const signer = new AgentokratiaSignerAdapter(input.wallet)
  const purchaseResult = await purchase({
    cfg,
    signer,
    subject: context.subject,
    principal: context.principal,
    resource: context.resource,
    plan: context.plan,
    required: context.required,
    quantity_requested: context.quantity_requested,
    pollIntervalMs: input.cfg.pollIntervalMs,
    pollTimeoutMs: input.cfg.pollTimeoutMs,
    sendTx: async (payment) => {
      const transfer = paymentInstructionToTransfer(payment)
      if (input.policy?.checkPayment) await input.policy.checkPayment(transfer)
      const tx = await input.wallet.sendErc20Transfer(transfer)
      return tx.txHash
    },
  })

  const invokeDescriptor = context.resolved.access?.invoke
  const invokeResult =
    input.invoke?.enabled === false || !invokeDescriptor
      ? { attempted: false }
      : await executeInvokeV1({
          invoke: invokeDescriptor,
          allowedRuntimeHeaders: input.invoke?.headers,
        })

  return {
    ok: true,
    product: context.resolved.product,
    context: {
      subject: context.subject,
      principal: context.principal,
      resource: context.resource,
      plan: context.plan,
    },
    session_id: purchaseResult.session.session_id,
    tx_hash: purchaseResult.tx_hash,
    verify: purchaseResult.verify,
    invoke: invokeResult,
  }
}

export function parseProductReference(raw: string): ProductResolveInput {
  return parseProductRef(raw)
}

function toAgentConfig(cfg: AgentokratiaValuyaConfig) {
  return {
    base: cfg.base,
    tenant_token: cfg.tenantToken,
  }
}

function paymentInstructionToTransfer(
  payment: Extract<PaymentInstruction, { method: "onchain" }>,
): GuardianErc20TransferInput {
  return {
    chainId: payment.chain_id,
    tokenAddress: payment.token_address,
    to: payment.to_address,
    amountRaw: payment.amount_raw,
    decimals: payment.decimals,
  }
}
