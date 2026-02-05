#!/usr/bin/env node
import { Command } from "commander"
import { cmdCreateSession } from "./commands/createSession.js"
import { cmdSignProof } from "./commands/signProof.js"
import { cmdSubmitTx } from "./commands/submitTx.js"
import { cmdWait } from "./commands/wait.js"
import { cmdAgentPay } from "./commands/agentPay.js"
import { cmdAgentProductCreate } from "./commands/createProduct.js"
const program = new Command()

program.name("valuya").description("Valuya Guard agent CLI").version("0.1.0")

cmdCreateSession(program)
cmdSignProof(program)
cmdSubmitTx(program)
cmdWait(program)
cmdAgentPay(program)
cmdAgentProductCreate(program)

program.parseAsync(process.argv).catch((e) => {
  console.error(String(e.message ?? e))
  process.exit(1)
})
