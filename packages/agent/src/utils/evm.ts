import type { Provider, TransactionRequest, TransactionResponse } from "ethers"

export type EvmSigner = {
  getAddress(): Promise<string>
  signMessage(message: string): Promise<string>

  // ethers Wallet/Signer types this as Provider | null
  provider: Provider | null

  // only needed if you ever send tx via signer
  sendTransaction?(tx: TransactionRequest): Promise<TransactionResponse>
}
