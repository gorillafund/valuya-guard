export type CanonicalSubjectV2 = { type: string; id: string }

export function subjectKey(s: CanonicalSubjectV2): string {
  return `${s.type}:${s.id}`
}

export function canonicalizeWalletAddress(addr: string): string {
  return String(addr).trim().toLowerCase()
}
