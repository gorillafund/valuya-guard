import type { ChannelMandateResolution } from "../domain/types.js"

export interface ChannelMandateResolver {
  resolve(args: {
    protocolSubjectHeader: string
    resource: string
    plan: string
  }): Promise<ChannelMandateResolution>
}
