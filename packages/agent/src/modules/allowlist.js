function normalizeBase(base) {
    return base.replace(/\/+$/, "");
}
function headers(cfg) {
    return {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.tenant_token}`,
    };
}
export async function allowlistAdd(args) {
    const base = normalizeBase(args.cfg.base);
    const url = `${base}/api/v2/allowlists/wallets`;
    const resp = await fetch(url, {
        method: "POST",
        headers: headers(args.cfg),
        body: JSON.stringify(args.body),
    });
    const txt = await resp.text();
    if (!resp.ok) {
        throw new Error(`allowlistAdd_failed:${resp.status}:${txt.slice(0, 500)}`);
    }
    return JSON.parse(txt);
}
