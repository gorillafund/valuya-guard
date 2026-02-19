import type { AgentConfig } from "../types.js"
import { apiJson } from "../client/http.js"
import { ROUTES } from "../client/routes.js"
import { AgentVerifySessionResponseV2 } from "@valuya/core"

export async function submitAgentTx(args: {
  cfg: AgentConfig
  sessionId: string
  wallet_address: string
  tx_hash: string
  signature: string
  proof: any
}) {
  return apiJson({
    cfg: args.cfg,
    method: "POST",
    path: ROUTES.agentSessionTx(args.sessionId),
    body: {
      wallet_address: args.wallet_address,
      tx_hash: args.tx_hash,
      signature: args.signature,
      proof: args.proof,
    },
    headers: {
      Accept: "application/json",
    },
  })
}

export async function verifySession(args: {
  cfg: AgentConfig
  sessionId: string
  wallet_address: string
}): Promise<AgentVerifySessionResponseV2> {
  return apiJson<AgentVerifySessionResponseV2>({
    cfg: args.cfg,
    method: "POST",
    path: ROUTES.agentSessionVerify(args.sessionId),
    body: { wallet_address: args.wallet_address },
  })
}
