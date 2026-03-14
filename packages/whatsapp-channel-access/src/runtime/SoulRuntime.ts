import type { SoulDefinition, SoulMemory, SoulResponse } from "../domain/types.js"

export interface SoulRuntime {
  run(args: {
    soul: SoulDefinition
    message: string
    memory: SoulMemory
    protocolSubjectHeader: string
    locale?: string
  }): Promise<SoulResponse>
}
