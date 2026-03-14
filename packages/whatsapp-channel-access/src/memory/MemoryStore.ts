import type { SoulMemory } from "../domain/types.js"

export interface MemoryStore {
  load(args: { whatsappUserId: string; soulId: string }): Promise<SoulMemory>
  save(args: { whatsappUserId: string; soulId: string; memory: SoulMemory }): Promise<void>
}
