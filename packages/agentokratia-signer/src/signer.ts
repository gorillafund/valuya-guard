import type { EvmSigner } from "@valuya/agent"
import type { GuardianWalletLike } from "./types.js"

/**
 * Bridge Guardian wallet to Valuya EvmSigner interface.
 */
export class AgentokratiaSignerAdapter implements EvmSigner {
  readonly provider = null

  constructor(private readonly wallet: GuardianWalletLike) {}

  getAddress(): Promise<string> {
    return this.wallet.getAddress()
  }

  signMessage(message: string): Promise<string> {
    return this.wallet.signMessage(message)
  }
}
