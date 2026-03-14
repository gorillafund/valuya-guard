export interface GuardToolClient {
  getChannelAccessState(args: {
    protocolSubjectHeader: string
    resource: string
    plan: string
  }): Promise<Record<string, unknown>>
  getEntitlements(args: {
    protocolSubjectHeader: string
    resource: string
    plan: string
  }): Promise<Record<string, unknown>>
  getRecentOrders?(args: {
    protocolSubjectHeader: string
  }): Promise<Record<string, unknown>>
  getRecentPayments?(args: {
    protocolSubjectHeader: string
  }): Promise<Record<string, unknown>>
}
