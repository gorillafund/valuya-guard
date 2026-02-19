export function domainSeparator(parts: string[]): string {
  // deterministic and easy to audit
  return parts.map((p) => String(p).trim()).join("|")
}
