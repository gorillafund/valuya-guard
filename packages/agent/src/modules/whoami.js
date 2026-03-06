import { apiJson } from "../client/http.js";
import { ROUTES } from "../client/routes.js";
export async function whoami(args) {
    return apiJson({
        cfg: args.cfg,
        method: "GET",
        path: ROUTES.agentWhoami,
    });
}
