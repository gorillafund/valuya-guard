// packages/agent/src/chain/provider.ts

import { JsonRpcProvider } from "ethers"

export function createProvider(rpcUrl: string): JsonRpcProvider {
  if (!rpcUrl) {
    throw new Error("RPC URL required")
  }

  return new JsonRpcProvider(rpcUrl)
}
