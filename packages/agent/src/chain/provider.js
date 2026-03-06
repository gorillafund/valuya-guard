// packages/agent/src/chain/provider.ts
import { JsonRpcProvider } from "ethers";
export function createProvider(rpcUrl) {
    if (!rpcUrl) {
        throw new Error("RPC URL required");
    }
    return new JsonRpcProvider(rpcUrl);
}
