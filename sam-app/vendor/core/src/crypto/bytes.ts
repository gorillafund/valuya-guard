// packages/core/src/crypto/bytes.ts

export function utf8ToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

export function bytesToHex(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  let out = ""
  for (const b of bytes) out += b.toString(16).padStart(2, "0")
  return out
}
