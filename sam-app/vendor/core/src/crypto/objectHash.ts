import { stableJsonStringify } from "../canon/json.js"
import { sha256Hex, type SubtleProvider } from "./hash.js"

export async function objectSha256Hex(
  obj: any,
  provider?: SubtleProvider,
): Promise<string> {
  const s = stableJsonStringify(obj)
  return sha256Hex(s, provider)
}
