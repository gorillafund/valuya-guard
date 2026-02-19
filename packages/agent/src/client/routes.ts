export const ROUTES = {
  // Checkout
  checkoutSessionsCreate: "/api/v2/checkout/sessions",
  checkoutSessionsShow: (sessionId: string) =>
    `/api/v2/checkout/sessions/${sessionId}`,

  // Agent payment
  agentSessionTx: (sessionId: string) =>
    `/api/v2/agent/sessions/${sessionId}/tx`,

  agentSessionVerify: (sessionId: string) =>
    `/api/v2/agent/sessions/${sessionId}/verify`,

  // Allowlists (NO agent prefix!)
  allowlistWalletsCreate: "/api/v2/allowlists/wallets",
  allowlistWalletsList: "/api/v2/allowlists/wallets",

  // Agent products
  agentProductsCreate: "/api/v2/agent/products",
  agentProductsList: "/api/v2/agent/products",

  // Agent challenges
  agentChallengesCreate: "/api/v2/agent/challenges",
} as const
