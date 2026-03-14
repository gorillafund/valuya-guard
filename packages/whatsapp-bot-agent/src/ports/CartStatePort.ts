export type ActiveCartSnapshot = {
  orderId?: string
  recipeTitle?: string
  items: unknown[]
  totalCents?: number
  currency?: string
}

export type CartStatePort = {
  getActiveCart(args: {
    whatsappUserId: string
  }): Promise<ActiveCartSnapshot | null>
}
