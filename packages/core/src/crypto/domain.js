export function domainSeparator(parts) {
    // deterministic and easy to audit
    return parts.map((p) => String(p).trim()).join("|");
}
