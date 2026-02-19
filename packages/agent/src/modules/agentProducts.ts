import type { AgentConfig } from "../types.js"
import type { EvmSigner } from "../utils/evm.js"
import { stableJson, sha256HexUtf8 } from "../crypto/stableJsonSha256.js"

function normalizeBase(base: string): string {
  return base.replace(/\/+$/, "")
}

function headers(cfg: AgentConfig): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${cfg.tenant_token}`,
  }
}

export type AgentChallengeResponse = {
  ok?: boolean
  nonce: string
  message: string
}

export async function createAgentChallenge(args: {
  cfg: AgentConfig
  principal: { type: string; id: string }
  wallet_address: string
  action: "product:create"
  request_sha256: string
}): Promise<AgentChallengeResponse> {
  const base = normalizeBase(args.cfg.base)
  const url = `${base}/api/v2/agent/challenges`

  const resp = await fetch(url, {
    method: "POST",
    headers: headers(args.cfg),
    body: JSON.stringify({
      principal_subject_type: args.principal.type,
      principal_subject_id: args.principal.id,
      wallet_address: args.wallet_address.toLowerCase(),
      action: args.action,
      request_sha256: args.request_sha256,
    }),
  })

  const txt = await resp.text()
  if (!resp.ok) {
    throw new Error(
      `createAgentChallenge_failed:${resp.status}:${txt.slice(0, 500)}`,
    )
  }
  return JSON.parse(txt)
}

export async function createProductAsAgent(args: {
  cfg: AgentConfig
  principal: { type: string; id: string }
  signer: EvmSigner
  product: any
}): Promise<any> {
  const base = normalizeBase(args.cfg.base)
  const url = `${base}/api/v2/agent/products`

  const wallet_address = (await args.signer.getAddress()).toLowerCase()

  // Deterministic request hash (must match server expectations)
  const canonical = stableJson(args.product)
  const request_sha256 = sha256HexUtf8(canonical)

  const ch = await createAgentChallenge({
    cfg: args.cfg,
    principal: args.principal,
    wallet_address,
    action: "product:create",
    request_sha256,
  })

  const signature = await args.signer.signMessage(ch.message)

  const resp = await fetch(url, {
    method: "POST",
    headers: headers(args.cfg),
    body: JSON.stringify({
      principal_subject_type: args.principal.type,
      principal_subject_id: args.principal.id,
      wallet_address,
      nonce: ch.nonce,
      signature,
      request_sha256,
      product: args.product,
    }),
  })

  const txt = await resp.text()
  if (!resp.ok) {
    throw new Error(
      `createProductAsAgent_failed:${resp.status}:${txt.slice(0, 800)}`,
    )
  }
  return JSON.parse(txt)
}
