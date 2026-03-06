export function subjectKey(s) {
    return `${s.type}:${s.id}`;
}
export function canonicalizeWalletAddress(addr) {
    return String(addr).trim().toLowerCase();
}
