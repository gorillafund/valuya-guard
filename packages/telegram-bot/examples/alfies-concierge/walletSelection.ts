export type WalletSelectionInput = {
  subjectHeader: string
  signerWalletAddress: string
  linkedPrivyWalletAddress: string | null
}

export type WalletSelectionResult =
  | {
      ok: true
      walletAddress: string
      walletSource: "linked_privy_wallet"
    }
  | {
      ok: false
      error:
        | "linked_privy_wallet_missing_fail_safe"
        | "linked_privy_wallet_signer_mismatch_fail_safe"
      message: string
    }

export function selectWalletForLinkedUserPurchase(
  input: WalletSelectionInput,
): WalletSelectionResult {
  const subjectHeader = String(input.subjectHeader || "").trim()
  const signer = normalizeWallet(input.signerWalletAddress)
  const linked = normalizeWallet(input.linkedPrivyWalletAddress)

  if (!linked) {
    return {
      ok: false,
      error: "linked_privy_wallet_missing_fail_safe",
      message: `No linked Privy wallet available for ${subjectHeader}`,
    }
  }

  if (!signer || signer !== linked) {
    return {
      ok: false,
      error: "linked_privy_wallet_signer_mismatch_fail_safe",
      message: `Signer wallet ${signer || "n/a"} does not match linked Privy wallet ${linked}`,
    }
  }

  return {
    ok: true,
    walletAddress: linked,
    walletSource: "linked_privy_wallet",
  }
}

export function extractLinkedPrivyWalletAddress(rawWhoami: unknown): string | null {
  const b = readRecord(rawWhoami)

  const candidates: unknown[] = [
    b?.linked_wallet_address,
    b?.privy_wallet_address,
    readRecord(b?.principal)?.wallet_address,
    readRecord(readRecord(b?.principal)?.wallet)?.address,
    readRecord(b?.subject)?.wallet_address,
    readRecord(readRecord(b?.subject)?.wallet)?.address,
    readRecord(b?.user)?.wallet_address,
    readRecord(readRecord(b?.user)?.wallet)?.address,
    readRecord(b?.privy_user)?.wallet_address,
    readRecord(readRecord(b?.privy_user)?.wallet)?.address,
  ]

  for (const c of candidates) {
    const n = normalizeWallet(c)
    if (n) return n
  }

  const wallets = Array.isArray(b?.wallets) ? b?.wallets : []
  for (const w of wallets) {
    const rec = readRecord(w)
    const n = normalizeWallet(rec?.address)
    if (n) return n
  }

  return null
}

export function normalizeWallet(input: unknown): string | null {
  const value = String(input || "").trim().toLowerCase()
  if (!value) return null
  if (!/^0x[a-f0-9]{40}$/.test(value)) return null
  return value
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null
}
