import { Wallet, JsonRpcProvider } from "ethers"
import type { EvmSigner } from "../utils/evm.js"

export function makeEthersSigner(
  privateKey: string,
  provider?: JsonRpcProvider,
): EvmSigner {
  const wallet = provider
    ? new Wallet(privateKey, provider)
    : new Wallet(privateKey)

  return {
    async getAddress() {
      return wallet.getAddress()
    },
    async signMessage(message: string) {
      return wallet.signMessage(message)
    },
    async sendTransaction(tx) {
      return wallet.sendTransaction(tx)
    },
    provider: wallet.provider ?? null,
  }
}
