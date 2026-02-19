#!/usr/bin/env node
import { Command } from "commander"
import { cmdCreateSession } from "./commands/createSession.js"
import { cmdSignProof } from "./commands/signProof.js"
import { cmdSubmitTx } from "./commands/submitTx.js"
import { cmdAgentPay } from "./commands/agentPay.js"
import { cmdAgentProductCreate } from "./commands/createProduct.js"
import { cmdAgentAllowlistAdd } from "./commands/allowlistAdd.js"
import { cmdAgentProductsList } from "./commands/listProducts.js"

const program = new Command()

program
  .name("valuya")
  .description("Valuya Guard CLI")
  .option("--base <url>", "API base URL", process.env.VALUYA_BASE)
  .option(
    "--tenant-token <token>",
    "Tenant token",
    process.env.VALUYA_TENANT_TOKEN,
  )

cmdCreateSession(program)
cmdSignProof(program)
cmdSubmitTx(program)
cmdAgentPay(program)
cmdAgentProductCreate(program)
cmdAgentAllowlistAdd(program)
cmdAgentProductsList(program)

program.parseAsync(process.argv)
