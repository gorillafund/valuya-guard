import { Wallet } from "ethers"
import { stableStringify, sha256Hex } from "./hash"

export async function createAgentChallenge(args: {
  cfg: { base: string; tenanttoken: string }
  principal: { type: string; id: string }
  wallet_address: string
  action: "product:create"
  request_sha256: string
}) {
  const res = await fetch(`${args.cfg.base}/api/v2/agent/challenges`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.cfg.tenanttoken}`,
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
  cfg: { base: string; tenanttoken: string }
  principal: { type: string; id: string }
  wallet: Wallet
  product: any
}) {
  const walletAddr = (await args.wallet.getAddress()).toLowerCase()
  const canonical = stableStringify(args.product)
  const request_sha256 = sha256Hex(canonical)

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
      Authorization: `Bearer ${args.cfg.tenanttoken}`,
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
