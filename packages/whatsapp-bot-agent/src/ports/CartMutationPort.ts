export type CartMutationPort = {
  addBundle(args: {
    whatsappUserId: string
    productIds: number[]
  }): Promise<{ message: string; cart: Record<string, unknown> }>
  addProduct(args: {
    whatsappUserId: string
    productId: number
    quantity: number
  }): Promise<{ message: string; cart: Record<string, unknown> }>
  removeProduct(args: {
    whatsappUserId: string
    productId: number
  }): Promise<{ message: string; cart: Record<string, unknown> }>
  setProductQuantity(args: {
    whatsappUserId: string
    productId: number
    quantity: number
  }): Promise<{ message: string; cart: Record<string, unknown> }>
}
