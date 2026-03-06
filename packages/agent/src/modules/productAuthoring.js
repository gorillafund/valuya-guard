import { apiJson } from "../client/http.js";
import { ROUTES } from "../client/routes.js";
export async function listProductTypes(args) {
    return apiJson({
        cfg: args.cfg,
        method: "GET",
        path: ROUTES.agentProductsTypes,
    });
}
export async function getProductCreateSchema(args) {
    const t = encodeURIComponent(String(args.type));
    return apiJson({
        cfg: args.cfg,
        method: "GET",
        path: `${ROUTES.agentProductsSchema}/${t}`,
    });
}
export async function prepareProductForCreate(args) {
    return apiJson({
        cfg: args.cfg,
        method: "POST",
        path: ROUTES.agentProductsPrepare,
        body: { draft: args.payload },
    });
}
