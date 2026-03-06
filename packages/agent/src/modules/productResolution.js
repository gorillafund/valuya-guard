import { apiJson } from "../client/http.js";
import { ROUTES } from "../client/routes.js";
import { whoami } from "./whoami.js";
export async function resolveProduct(args) {
    return apiJson({
        cfg: args.cfg,
        method: "POST",
        path: ROUTES.agentProductsResolve,
        body: args.input,
    });
}
function parseSubject(input) {
    if (!input?.type || !input?.id)
        return null;
    return { type: String(input.type), id: String(input.id) };
}
export function parseProductRef(raw) {
    const v = String(raw ?? "").trim();
    if (!v)
        throw new Error("product_ref_required");
    if (v.startsWith("id:")) {
        const idPart = v.slice(3).trim();
        if (!idPart)
            throw new Error("invalid_product_ref:id");
        const n = Number(idPart);
        return Number.isFinite(n) ? { product_id: n } : { product_id: idPart };
    }
    if (v.startsWith("slug:")) {
        const slug = v.slice(5).trim();
        if (!slug)
            throw new Error("invalid_product_ref:slug");
        return { slug };
    }
    if (v.startsWith("external:")) {
        const external_id = v.slice(9).trim();
        if (!external_id)
            throw new Error("invalid_product_ref:external");
        return { external_id };
    }
    const n = Number(v);
    if (Number.isFinite(n))
        return { product_id: n };
    return { slug: v };
}
export async function resolvePurchaseContext(args) {
    const [me, pr] = await Promise.all([
        whoami({ cfg: args.cfg }),
        resolveProduct({ cfg: args.cfg, input: args.product }),
    ]);
    const principal = parseSubject(pr.access?.principal) ??
        parseSubject(me.principal?.subject) ??
        null;
    if (!principal)
        throw new Error("principal_not_bound");
    const subject = parseSubject(pr.access?.subject) ?? principal;
    const resource = String(pr.access?.resource ?? "").trim();
    if (!resource)
        throw new Error("resolved_resource_missing");
    const plan = String(pr.access?.plan ?? pr.product?.plan ?? "").trim() || "pro";
    const required = (pr.access?.required ?? {
        type: "subscription",
        plan,
    });
    const quantity_requested = typeof pr.access?.quantity_default === "number"
        ? pr.access.quantity_default
        : undefined;
    return {
        subject,
        principal,
        resource,
        plan,
        required,
        quantity_requested,
        whoami: me,
        resolved: pr,
    };
}
