// cli/src/chain/sendErc20.ts

import { Contract } from "ethers"
import type { PaymentInstruction } from "@valuya/core"
import { EvmSigner } from "@valuya/agent"
const ERC20_ABI = [
  "function transfer(address to, uint256 value) returns (bool)",
]

export async function sendErc20Transfer(args: {
  signer: EvmSigner
  payment: Extract<PaymentInstruction, { method: "onchain" }>
}): Promise<string> {
  const { signer: wallet, payment } = args

  if (payment.method !== "onchain") {
    throw new Error("Not an onchain payment")
  }

  if (!payment.token_address) {
    throw new Error("Missing token_address")
  }

  const token = new Contract(payment.token_address, ERC20_ABI, wallet)

  const tx = await token.transfer(payment.to_address, payment.amount_raw)

  const receipt = await tx.wait()
  return receipt?.hash ?? tx.hash
}
