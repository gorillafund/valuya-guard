import path from "node:path"
import {
  generateGatedChannelConfig,
  parseGatedChannelArgs,
  resolveGatedChannelOptions,
  writeGatedChannelConfig,
} from "./lib/gatedChannel.js"

function main(): void {
  const options = resolveGatedChannelOptions(parseGatedChannelArgs(process.argv.slice(2)))
  const repoRoot = process.cwd()
  const { outputPath, output } = generateGatedChannelConfig(repoRoot, options)
  writeGatedChannelConfig(outputPath, output)

  console.log(`Wrote gated channel config: ${path.relative(repoRoot, outputPath)}`)
  console.log(`Channel: ${options.channel}`)
  console.log(`Preset: ${options.preset}`)
  console.log(`Slug: ${options.slug}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error("")
  console.error("Usage:")
  console.error("  pnpm gated-channel:new --channel whatsapp --preset mentor --slug mentor_demo")
  console.error("  pnpm gated-channel:new --channel telegram --preset concierge --slug vip_concierge --output .data/vip.env")
  process.exit(1)
}
