import type { AgentSubject } from "@valuya/agent"
import type { FileStateStore } from "./stateStore.js"
import type { PaymentRequired, PaymentSuccess, ValuyaPayClient } from "./valuyaPay.js"

export class PaymentAdapter {
  private readonly payClient: ValuyaPayClient
  private readonly stateStore: FileStateStore

  constructor(args: { payClient: ValuyaPayClient; stateStore: FileStateStore }) {
    this.payClient = args.payClient
    this.stateStore = args.stateStore
  }

  async startCheckoutWithExistingFlow(args: Parameters<ValuyaPayClient["ensurePaid"]>[0]): Promise<PaymentSuccess | PaymentRequired> {
    return this.payClient.ensurePaid(args)
  }

  async getCheckoutStatus(localOrderId: string): Promise<{
    checkoutId: string | null
    checkoutUrl: string | null
    status: string | null
  }> {
    const link = await this.stateStore.getMarketplaceOrderLink(localOrderId)
    return {
      checkoutId: link?.valuya_order_id || null,
      checkoutUrl: link?.checkout_url || null,
      status: link?.status || null,
    }
  }

  async sendPaymentLinkFromExistingFlow(localOrderId: string): Promise<string | null> {
    const status = await this.getCheckoutStatus(localOrderId)
    return status.checkoutUrl
  }
}
