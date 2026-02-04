// sendTransaction.ts
import {
  ethers,
  Wallet,
  JsonRpcProvider,
  Contract,
  TransactionResponse,
} from "ethers"
import "dotenv/config"

// Custom error for better debugging
export class SendTransactionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = "SendTransactionError"
  }
}

interface SendTransactionArgs {
  payment: {
    method: "onchain"
    currency: string // e.g. "EUR"
    token: string // e.g. "EURe"
    chain_id: number // e.g. 137 or 8453
    to_address: string
    amount_raw: string // e.g. "10000000000000000"
    decimals: number // 18
    token_address: string
  }
  rpcUrl?: string // optional override
  privateKey?: string // optional override
}

/**
 * Sends an ERC-20 transfer based on Valuya payment instruction.
 * Supports Polygon (137) and Base (8453).
 *
 * @returns The transaction hash (0x...)
 * @throws SendTransactionError on failure
 */
export async function sendTransaction({
  payment,
  rpcUrl: providedRpcUrl,
  privateKey: providedPrivateKey,
}: SendTransactionArgs): Promise<string> {
  if (payment.method !== "onchain") {
    throw new SendTransactionError(
      `Unsupported payment method: ${payment.method}`,
    )
  }

  if (payment.chain_id !== 137 && payment.chain_id !== 8453) {
    throw new SendTransactionError(
      `Unsupported chain: only Polygon (137) and Base (8453) are currently supported. Got ${payment.chain_id}`,
    )
  }

  // Select RPC based on chain
  let rpc: string | undefined

  if (payment.chain_id === 137) {
    rpc =
      providedRpcUrl || process.env.RPC_POLYGON || process.env.VALUYA_RPC_URL
  } else if (payment.chain_id === 8453) {
    rpc = providedRpcUrl || process.env.RPC_BASE || process.env.VALUYA_RPC_URL
  }

  if (!rpc) {
    throw new SendTransactionError(
      `No RPC URL found for chain ${payment.chain_id}. ` +
        `Set ${payment.chain_id === 137 ? "RPC_POLYGON" : "RPC_BASE"} or VALUYA_RPC_URL in .env`,
    )
  }

  const privateKey = providedPrivateKey || process.env.VALUYA_PRIVATE_KEY

  if (!privateKey) {
    throw new SendTransactionError(
      "VALUYA_PRIVATE_KEY is missing in environment",
    )
  }

  if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey.trim())) {
    throw new SendTransactionError(
      "VALUYA_PRIVATE_KEY appears invalid (not 64 hex chars after 0x)",
    )
  }

  // ── Connect to chain ──────────────────────────────────────────────────
  const provider = new JsonRpcProvider(rpc)
  const wallet = new Wallet(privateKey, provider)

  const from = wallet.address

  console.log(`→ Chain: ${payment.chain_id}`)
  console.log(`→ Sending from: ${from}`)
  console.log(`→ To: ${payment.to_address}`)
  console.log(`→ Token: ${payment.token} (${payment.token_address})`)
  console.log(
    `→ Amount raw: ${payment.amount_raw} (${payment.decimals} decimals)`,
  )

  // Basic validation
  if (!ethers.isAddress(payment.to_address)) {
    throw new SendTransactionError(`Invalid to_address: ${payment.to_address}`)
  }
  if (!ethers.isAddress(payment.token_address)) {
    throw new SendTransactionError(
      `Invalid token_address: ${payment.token_address}`,
    )
  }

  // ── Execute ERC-20 transfer ───────────────────────────────────────────
  const erc20Abi = [
    "function transfer(address to, uint256 amount) external returns (bool)",
  ]

  const contract = new Contract(payment.token_address, erc20Abi, wallet)

  let tx: TransactionResponse

  try {
    tx = await contract.transfer(payment.to_address, payment.amount_raw, {
      // Optional: add gas overrides if needed on congested chains
      // gasLimit: 120000,
    })

    console.log(`✔ Transaction sent: ${tx.hash}`)

    // Optional: await confirmation (uncomment if you want to wait)
    // const receipt = await tx.wait(1);
    // console.log(`Confirmed in block ${receipt?.blockNumber}`);

    return tx.hash
  } catch (err: any) {
    const msg = err?.reason || err?.shortMessage || err?.message || String(err)
    throw new SendTransactionError(`Transaction failed: ${msg}`, err)
  }
}
