// packages/core/src/crypto/hash.ts
import { bytesToHex, utf8ToBytes } from "./bytes.js";
function toArrayBuffer(u8) {
    // Create a guaranteed-ArrayBuffer-backed copy (avoids SharedArrayBuffer typing issues)
    const copy = new Uint8Array(u8.byteLength);
    copy.set(u8);
    return copy.buffer;
}
export async function sha256Hex(input, provider) {
    const subtle = provider?.subtle ?? globalThis.crypto?.subtle;
    if (!subtle) {
        throw new Error("WebCrypto not available. Provide a SubtleCrypto provider.");
    }
    const u8 = utf8ToBytes(input);
    const ab = toArrayBuffer(u8);
    const digest = await subtle.digest("SHA-256", ab);
    return bytesToHex(digest);
}
