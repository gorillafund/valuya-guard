#!/usr/bin/env node
import { Command } from "commander"
import { cmdCreateSession } from "./commands/createSession.js"
import { cmdSignProof } from "./commands/signProof.js"
import { cmdSubmitTx } from "./commands/submitTx.js"
import { cmdAgentPay } from "./commands/agentPay.js"
import { cmdAgentProductCreate } from "./commands/createProduct.js"
import { cmdAgentAllowlistAdd } from "./commands/allowlistAdd.js"
import { cmdAgentProductsList } from "./commands/listProducts.js"
import { cmdAgentWhoami } from "./commands/whoami.js"
import { cmdAgentProductResolve } from "./commands/resolveProduct.js"
import { cmdAgentBuy } from "./commands/buyProduct.js"
import { cmdAgentProductTypes } from "./commands/productTypes.js"
import { cmdAgentProductSchema } from "./commands/productSchema.js"
import { cmdAgentProductPrepare } from "./commands/productPrepare.js"

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
cmdAgentWhoami(program)
cmdAgentProductResolve(program)
cmdAgentBuy(program)
cmdAgentProductTypes(program)
cmdAgentProductSchema(program)
cmdAgentProductPrepare(program)

program.parseAsync(process.argv)
