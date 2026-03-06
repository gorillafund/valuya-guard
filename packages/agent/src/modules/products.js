import { stableJson, sha256HexUtf8 } from "../crypto/index.js";
import { createAgentChallenge } from "./challenges.js";
export async function createProductAsAgent(args) {
    const wallet_address = (await args.signer.getAddress()).toLowerCase();
    const canonical = stableJson(args.product);
    const request_sha256 = sha256HexUtf8(canonical);
    // call shared challenge API wrapper
    const ch = (await createAgentChallenge({
        cfg: args.cfg,
        payload: {
            principal_subject_type: args.principal.type,
            principal_subject_id: args.principal.id,
            wallet_address,
            action: "product:create",
            request_sha256,
        },
    }));
    const signature = await args.signer.signMessage(ch.message);
    // use your existing apiJson + ROUTES instead of raw fetch if you have it
    const res = await fetch(`${args.cfg.base.replace(/\/+$/, "")}/api/v2/agent/products`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authorization: `Bearer ${args.cfg.tenant_token}`,
        },
        body: JSON.stringify({
            principal_subject_type: args.principal.type,
            principal_subject_id: args.principal.id,
            wallet_address,
            nonce: ch.nonce,
            signature,
            request_sha256,
            product: args.product,
        }),
    });
    const txt = await res.text();
    if (!res.ok) {
        throw new Error(`createProductAsAgent_failed:${res.status}:${txt.slice(0, 800)}`);
    }
    return JSON.parse(txt);
}
