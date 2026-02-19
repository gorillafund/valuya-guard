// packages/core/src/subject.ts

export type Subject =
  | { type: "user"; id: string }
  | { type: "anon"; id: string }
  | { type: "agent"; id: string }
  | { type: "wallet"; id: string }
  | { type: "api_key"; id: string }
  | { type: "telegram"; id: string }
  | { type: string; id: string } // ✅ escape hatch

export type CanonicalSubject = Subject

export function subjectKey(s: Subject): string {
  return `${s.type}:${s.id}`
}

// Optional but useful for wallet subjects:
export function canonicalizeWalletAddress(addr: string): string {
  // deterministic + simple: lowercasing. (If you later want EIP-55, do it everywhere.)
  return addr.trim().toLowerCase()
}
