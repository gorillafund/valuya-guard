import { InMemoryMemoryStore as CoreInMemoryMemoryStore } from "@valuya/channel-access-core"
import type { SoulMemory } from "../domain/types.js"
import type { MemoryStore } from "./MemoryStore.js"

export class InMemoryMemoryStore implements MemoryStore {
  private readonly inner = new CoreInMemoryMemoryStore()

  async load(args: { whatsappUserId: string; soulId: string }): Promise<SoulMemory> {
    return this.inner.load({ userId: args.whatsappUserId, soulId: args.soulId })
  }

  async save(args: { whatsappUserId: string; soulId: string; memory: SoulMemory }): Promise<void> {
    return this.inner.save({ userId: args.whatsappUserId, soulId: args.soulId, memory: args.memory })
  }
}
