import { apiJson } from "../client/http.js";
import { ROUTES } from "../client/routes.js";
export async function submitAgentTx(args) {
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
    });
}
export async function verifySession(args) {
    return apiJson({
        cfg: args.cfg,
        method: "POST",
        path: ROUTES.agentSessionVerify(args.sessionId),
        body: { wallet_address: args.wallet_address },
    });
}
