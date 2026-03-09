import test from "node:test"
import assert from "node:assert/strict"
import {
  extractLinkedPrivyWalletAddress,
  normalizeWallet,
  selectWalletForLinkedUserPurchase,
} from "../dist/telegram-bot/examples/alfies-concierge/walletSelection.js"

test("linked user purchase uses linked wallet when signer matches", () => {
  const res = selectWalletForLinkedUserPurchase({
    subjectHeader: "user:10",
    signerWalletAddress: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
    linkedPrivyWalletAddress: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
  })
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.walletAddress, "0x563efeff9fb7d6fd0243e5b9cf620690b69058a7")
    assert.equal(res.walletSource, "linked_privy_wallet")
  }
})

test("env signer wallet is not used when linked wallet exists and differs", () => {
  const res = selectWalletForLinkedUserPurchase({
    subjectHeader: "user:10",
    signerWalletAddress: "0xba5a1e7c85d8841add147833b9b30861db662e67",
    linkedPrivyWalletAddress: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
  })
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.equal(res.error, "linked_privy_wallet_signer_mismatch_fail_safe")
  }
})

test("missing linked wallet fails clearly", () => {
  const res = selectWalletForLinkedUserPurchase({
    subjectHeader: "user:10",
    signerWalletAddress: "0xba5a1e7c85d8841add147833b9b30861db662e67",
    linkedPrivyWalletAddress: null,
  })
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.equal(res.error, "linked_privy_wallet_missing_fail_safe")
  }
})

test("extractLinkedPrivyWalletAddress finds wallet from principal path", () => {
  const wallet = extractLinkedPrivyWalletAddress({
    principal: {
      wallet: {
        address: "0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7",
      },
    },
  })
  assert.equal(wallet, "0x563efeff9fb7d6fd0243e5b9cf620690b69058a7")
})

test("normalizeWallet enforces hex format", () => {
  assert.equal(normalizeWallet("0x563eFeff9fb7D6FD0243E5b9Cf620690b69058A7"), "0x563efeff9fb7d6fd0243e5b9cf620690b69058a7")
  assert.equal(normalizeWallet("did:privy:abc"), null)
  assert.equal(normalizeWallet(""), null)
})
