"use strict";
// packages/core/src/subject.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.subjectKey = subjectKey;
exports.canonicalizeWalletAddress = canonicalizeWalletAddress;
function subjectKey(s) {
    return "".concat(s.type, ":").concat(s.id);
}
// Optional but useful for wallet subjects:
function canonicalizeWalletAddress(addr) {
    // deterministic + simple: lowercasing. (If you later want EIP-55, do it everywhere.)
    return addr.trim().toLowerCase();
}
