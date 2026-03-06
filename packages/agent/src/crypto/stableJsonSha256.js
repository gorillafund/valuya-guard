import { createHash } from "node:crypto";
function stableNormalize(v) {
    if (Array.isArray(v))
        return v.map(stableNormalize);
    if (v && typeof v === "object") {
        const out = {};
        for (const k of Object.keys(v).sort()) {
            const vv = v[k];
            if (vv === undefined)
                continue;
            out[k] = stableNormalize(vv);
        }
        return out;
    }
    return v;
}
export function stableJson(value) {
    const normalized = stableNormalize(value);
    return JSON.stringify(normalized);
}
export function sha256HexUtf8(s) {
    return createHash("sha256").update(s, "utf8").digest("hex");
}
