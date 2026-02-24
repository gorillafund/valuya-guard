import {
  buyValuyaProductWithGuardian,
  parseProductReference,
  type GuardianWalletLike,
  type GuardianPolicyLike,
} from "@valuya/agentokratia-signer"

// Replace with real Guardian SDK integration.
const guardianWallet: GuardianWalletLike = {
  async getAddress() {
    return "0x0000000000000000000000000000000000000000"
  },
  async signMessage(_message: string) {
    throw new Error("implement_guardian_sign_message")
  },
  async sendErc20Transfer(_input) {
    throw new Error("implement_guardian_send_erc20_transfer")
  },
}

const guardianPolicy: GuardianPolicyLike = {
  async checkPayment(input) {
    if (!input.to || !input.tokenAddress) {
      throw new Error("guardian_policy_invalid_payment_target")
    }
  },
}

async function main() {
  const result = await buyValuyaProductWithGuardian({
    cfg: {
      base: process.env.VALUYA_BASE || "",
      tenantToken: process.env.VALUYA_TENANT_TOKEN || "",
      pollIntervalMs: 3000,
      pollTimeoutMs: 60000,
    },
    product: parseProductReference("slug:premium-agent-workflow"),
    wallet: guardianWallet,
    policy: guardianPolicy,
    invoke: { enabled: true },
  })

  console.log(JSON.stringify(result, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
