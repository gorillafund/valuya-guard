import { Wallet } from "ethers"
import { stableStringify, sha256Hex } from "./hash"
import { createHash } from "crypto"

export async function createAgentChallenge(args: {
  cfg: { base: string; tenant_token: string }
  principal: { type: string; id: string }
  wallet_address: string
  action: "product:create"
  request_sha256: string
}) {
  const res = await fetch(`${args.cfg.base}/api/v2/agent/challenges`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.cfg.tenant_token}`,
    },
    body: JSON.stringify({
      principal_subject_type: args.principal.type,
      principal_subject_id: args.principal.id,
      wallet_address: args.wallet_address.toLowerCase(),
      action: args.action,
      request_sha256: args.request_sha256,
    }),
  })
  if (!res.ok)
    throw new Error(
      `createAgentChallenge_failed:${res.status}:${await res.text()}`,
    )
  return await res.json()
}

export async function createProductAsAgent(args: {
  cfg: { base: string; tenant_token: string }
  principal: { type: string; id: string }
  wallet: Wallet
  product: any
}) {
  const walletAddr = (await args.wallet.getAddress()).toLowerCase()
  const canonical = stableJson(args.product)
  const request_sha256 = sha256HexUtf8(canonical)

  const ch = await createAgentChallenge({
    cfg: args.cfg,
    principal: args.principal,
    wallet_address: walletAddr,
    action: "product:create",
    request_sha256,
  })

  const signature = await args.wallet.signMessage(ch.message)

  const res = await fetch(`${args.cfg.base}/api/v2/agent/products`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.cfg.tenant_token}`,
    },
    body: JSON.stringify({
      principal_subject_type: args.principal.type,
      principal_subject_id: args.principal.id,
      wallet_address: walletAddr,
      nonce: ch.nonce,
      signature,
      request_sha256,
      product: args.product,
    }),
  })

  if (!res.ok)
    throw new Error(
      `createProductAsAgent_failed:${res.status}:${await res.text()}`,
    )
  return await res.json()
}

function stableNormalize(v: any): any {
  if (Array.isArray(v)) {
    // list: keep order
    return v.map(stableNormalize)
  }

  if (v && typeof v === "object") {
    // object: sort keys; drop undefined (JSON.stringify does this too)
    const out: Record<string, any> = {}
    for (const k of Object.keys(v).sort()) {
      const vv = v[k]
      if (vv === undefined) continue
      out[k] = stableNormalize(vv)
    }
    return out
  }

  // primitives
  return v
}

export function stableJson(value: any): string {
  const normalized = stableNormalize(value)
  // Match PHP: JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
  // JS already doesn't escape slashes; and keeps unicode.
  return JSON.stringify(normalized)
}

export function sha256HexUtf8(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex")
}
