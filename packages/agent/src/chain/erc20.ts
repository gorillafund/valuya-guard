import { Contract, getAddress, isAddress } from "ethers"
import type { PaymentInstruction } from "@valuya/core"
import type { EvmSigner } from "../utils/evm.js"

const ERC20_ABI = [
  "function transfer(address to, uint256 value) returns (bool)",
]
type OnchainPayment = Extract<PaymentInstruction, { method: "onchain" }>

export async function sendErc20Transfer(args: {
  signer: EvmSigner
  payment: OnchainPayment
}): Promise<string> {
  const { signer, payment } = args

  if (!payment.token_address) throw new Error("Missing token_address")
  if (!isAddress(payment.token_address))
    throw new Error(`Invalid token_address: ${payment.token_address}`)
  if (!isAddress(payment.to_address))
    throw new Error(`Invalid to_address: ${payment.to_address}`)
  if (!signer.provider)
    throw new Error("Signer.provider required to send transactions")

  const tokenAddress = getAddress(payment.token_address)
  const toAddress = getAddress(payment.to_address)

  const token = new Contract(tokenAddress, ERC20_ABI, signer)
  const tx = await token.transfer(toAddress, payment.amount_raw)

  const receipt = await tx.wait()
  return receipt?.hash ?? tx.hash
}
