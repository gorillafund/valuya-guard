import { FileStateStore } from "../../../whatsapp-bot/dist/whatsapp-bot/src/stateStore.js"
import type { ActiveCartSnapshot, CartStatePort } from "../ports/CartStatePort.js"

export class SharedStateCartPortAdapter implements CartStatePort {
  private readonly store: FileStateStore

  constructor(stateFile: string) {
    this.store = new FileStateStore(stateFile)
  }

  async getActiveCart(args: { whatsappUserId: string }): Promise<ActiveCartSnapshot | null> {
    const [conversation, profile] = await Promise.all([
      this.store.get(args.whatsappUserId),
      this.store.getProfile(args.whatsappUserId),
    ])

    const cart = profile?.profile?.currentCartSnapshot || conversation?.lastCart
    const items = Array.isArray(cart?.items) ? cart.items : []
    if (!items.length) return null

    return {
      orderId: conversation?.orderId,
      recipeTitle: profile?.profile?.selectedRecipeTitle || conversation?.lastRecipe?.title,
      items,
      totalCents: typeof cart?.total_cents === "number" ? Math.trunc(cart.total_cents) : undefined,
      currency: typeof cart?.currency === "string" && cart.currency.trim() ? cart.currency.trim() : "EUR",
    }
  }
}
