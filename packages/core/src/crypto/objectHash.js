import { stableJsonStringify } from "../canon/json.js";
import { sha256Hex } from "./hash.js";
export async function objectSha256Hex(obj, provider) {
    const s = stableJsonStringify(obj);
    return sha256Hex(s, provider);
}
