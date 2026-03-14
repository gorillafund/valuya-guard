import type { ToolRegistry } from "../ports/ToolRegistry.js"

export class StaticToolRegistry implements ToolRegistry {
  constructor(private readonly tools: ToolRegistry["listTools"], private readonly execute: ToolRegistry["executeTool"]) {}

  listTools() {
    return this.tools()
  }

  executeTool(args: Parameters<ToolRegistry["executeTool"]>[0]) {
    return this.execute(args)
  }
}
