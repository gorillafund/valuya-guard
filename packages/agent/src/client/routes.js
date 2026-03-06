export const ROUTES = {
    // Checkout
    checkoutSessionsCreate: "/api/v2/checkout/sessions",
    checkoutSessionsShow: (sessionId) => `/api/v2/checkout/sessions/${sessionId}`,
    // Agent payment
    agentSessionTx: (sessionId) => `/api/v2/agent/sessions/${sessionId}/tx`,
    agentSessionVerify: (sessionId) => `/api/v2/agent/sessions/${sessionId}/verify`,
    // Allowlists (NO agent prefix!)
    allowlistWalletsCreate: "/api/v2/allowlists/wallets",
    allowlistWalletsList: "/api/v2/allowlists/wallets",
    // Agent products
    agentProductsCreate: "/api/v2/agent/products",
    agentProductsList: "/api/v2/agent/products",
    agentProductsResolve: "/api/v2/agent/products/resolve",
    agentProductsTypes: "/api/v2/agent/products/types",
    agentProductsSchema: "/api/v2/agent/products/schema",
    agentProductsPrepare: "/api/v2/agent/products/prepare",
    // Agent challenges
    agentChallengesCreate: "/api/v2/agent/challenges",
    // Agent identity/context
    agentWhoami: "/api/v2/agent/whoami",
};
