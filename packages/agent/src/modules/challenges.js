// packages/agent/src/modules/challenges.ts
import { apiJson } from "../client/http.js";
import { ROUTES } from "../client/routes.js";
/**
 * Agent challenges are usually used to prove wallet ownership (or session binding).
 * This SDK function is a thin wrapper; we’ll tighten types after seeing controller response.
 */
export async function createAgentChallenge(args) {
    return apiJson({
        cfg: args.cfg,
        method: "POST",
        path: ROUTES.agentChallengesCreate,
        body: args.payload,
    });
}
