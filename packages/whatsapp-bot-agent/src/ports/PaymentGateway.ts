export type MarketplaceOrderRequest = {
  localOrderId: string
  protocolSubjectHeader: string
  guardSubjectId?: string
  guardSubjectType?: string
  guardSubjectExternalId?: string
  amountCents: number
  currency: string
  asset: string
  cart?: unknown
}

export type DelegatedPaymentRequest = {
  protocolSubjectHeader: string
  guardSubjectId?: string
  guardSubjectType?: string
  guardSubjectExternalId?: string
  principalSubjectType: string
  principalSubjectId: string
  walletAddress: string
  merchantOrderId?: string
  amountCents?: number
  currency: string
  asset: string
  actorType: string
  channel: string
  scope: string
  counterpartyType: string
  counterpartyId: string
  idempotencyKey: string
  cart?: unknown
}

export type PaymentGateway = {
  getEntitlement(args: {
    protocolSubjectHeader: string
    resource: string
    plan: string
  }): Promise<{ active: boolean; reason?: string }>
  createMarketplaceOrder(args: MarketplaceOrderRequest): Promise<{
    valuyaOrderId: string
    checkoutUrl?: string
  }>
  getMarketplaceOrder(args: {
    protocolSubjectHeader: string
    orderId: string
  }): Promise<Record<string, unknown>>
  requestDelegatedPayment(args: DelegatedPaymentRequest): Promise<Record<string, unknown>>
  createCheckoutLink(args: {
    protocolSubjectHeader: string
    orderId: string
  }): Promise<{ checkoutUrl: string }>
}
