import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { FileStateStore } from "./stateStore.js"
import { IntentExtractionService } from "./intentExtractionService.js"
import { ReferenceResolutionService } from "./referenceResolutionService.js"
import { ShoppingRouter } from "./shoppingRouter.js"
import { ContextGovernanceService } from "./contextGovernanceService.js"
import {
  UnderstandingAnalyticsService,
  buildEvalReport,
  buildEvalDiffReport,
  renderEvalSummary,
  renderEvalDiffSummary,
} from "./understandingAnalyticsService.js"

async function main(): Promise<void> {
  const [, , command = "", ...rest] = process.argv
  const stateFile =
    process.env.WHATSAPP_STATE_FILE?.trim() ||
    resolve(process.cwd(), ".data/whatsapp-state.sqlite")
  const store = new FileStateStore(stateFile)
  const analytics = new UnderstandingAnalyticsService(store)

  if (command === "export") {
    const outFile =
      rest[0] || resolve(process.cwd(), ".data/understanding-cases.json")
    const limit = parseOptionalInt(rest[1], 200)
    const feedbackOnly = rest.includes("--feedback-only")
    const count = await analytics.writeRecentCasesToFile({
      outFile,
      limit,
      feedbackOnly,
    })
    console.log(`Exported ${count} suggested eval cases to ${resolve(outFile)}`)
    return
  }

  if (command === "import") {
    const filePath = rest[0]
    if (!filePath) {
      throw new Error("understanding_eval_import_file_required")
    }
    const count = await analytics.importCasesFromFile(filePath)
    console.log(`Imported ${count} eval cases from ${resolve(filePath)}`)
    return
  }

  if (command === "run") {
    const limit = parseOptionalInt(rest[0], 1000)
    const jsonOut = parseJsonOut(rest.slice(1))
    const jsonHistoryDir = parseJsonHistoryDir(rest.slice(1))
    const summary = await analytics.runEval({
      intentExtractor: new IntentExtractionService({
        apiKey: process.env.OPENAI_API_KEY?.trim(),
        model: process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
      }),
      referenceResolver: new ReferenceResolutionService(),
      shoppingRouter: new ShoppingRouter(),
      contextGovernanceService: new ContextGovernanceService(),
      limit,
    })
    const report = buildEvalReport(summary)
    console.log(renderEvalSummary(summary))
    if (jsonOut) {
      const target = resolve(jsonOut)
      await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8")
      console.log(`\nWrote JSON report to ${target}`)
    }
    if (jsonHistoryDir) {
      const written = await writeHistoricalReport(jsonHistoryDir, report)
      console.log(`Wrote historical report to ${written.reportFile}`)
      console.log(`Updated latest report at ${written.latestFile}`)
    }
    process.exitCode = summary.failed > 0 ? 1 : 0
    return
  }

  if (command === "compare") {
    const baselineFile = rest[0]
    const currentFile = rest[1]
    if (!baselineFile || !currentFile) {
      throw new Error("understanding_eval_compare_files_required")
    }
    const baseline = JSON.parse(await readFile(resolve(baselineFile), "utf8"))
    const current = JSON.parse(await readFile(resolve(currentFile), "utf8"))
    console.log(renderEvalDiffSummary(buildEvalDiffReport({ baseline, current })))
    return
  }

  if (command === "compare-latest") {
    const historyDir = rest[0] || resolve(process.cwd(), ".data/understanding-history")
    const { baselineFile, currentFile } = await findLatestHistoricalReports(historyDir)
    const baseline = JSON.parse(await readFile(baselineFile, "utf8"))
    const current = JSON.parse(await readFile(currentFile, "utf8"))
    console.log(`Baseline: ${baselineFile}`)
    console.log(`Current: ${currentFile}`)
    console.log("")
    console.log(renderEvalDiffSummary(buildEvalDiffReport({ baseline, current })))
    return
  }

  console.log(
    [
      "Usage:",
      "  node dist/whatsapp-bot/src/understandingEval.js export [outFile] [limit] [--feedback-only]",
      "  node dist/whatsapp-bot/src/understandingEval.js import <file>",
      "  node dist/whatsapp-bot/src/understandingEval.js run [limit] [--json-out <file>] [--json-history-dir <dir>]",
      "  node dist/whatsapp-bot/src/understandingEval.js compare <baseline.json> <current.json>",
      "  node dist/whatsapp-bot/src/understandingEval.js compare-latest [historyDir]",
    ].join("\n"),
  )
}

function parseOptionalInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback
}

function parseJsonOut(args: string[]): string | undefined {
  const index = args.findIndex((value) => value === "--json-out")
  if (index === -1) return undefined
  const file = args[index + 1]
  return file?.trim() || undefined
}

function parseJsonHistoryDir(args: string[]): string | undefined {
  const index = args.findIndex((value) => value === "--json-history-dir")
  if (index === -1) return undefined
  const dir = args[index + 1]
  return dir?.trim() || undefined
}

async function writeHistoricalReport(
  historyDir: string,
  report: ReturnType<typeof buildEvalReport>,
): Promise<{ reportFile: string; latestFile: string }> {
  const targetDir = resolve(historyDir)
  await mkdir(targetDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
  const reportFile = resolve(targetDir, `understanding-report-${timestamp}.json`)
  const latestFile = resolve(targetDir, "latest.json")
  const payload = `${JSON.stringify(report, null, 2)}\n`
  await writeFile(reportFile, payload, "utf8")
  await writeFile(latestFile, payload, "utf8")
  return { reportFile, latestFile }
}

async function findLatestHistoricalReports(
  historyDir: string,
): Promise<{ baselineFile: string; currentFile: string }> {
  const targetDir = resolve(historyDir)
  const entries = await readdir(targetDir)
  const reportFiles = entries
    .filter((entry) => /^understanding-report-\d{8}T\d{6}Z\.json$/.test(entry))
    .sort()
  if (reportFiles.length < 2) {
    throw new Error("understanding_eval_compare_latest_requires_two_reports")
  }
  const baselineFile = resolve(targetDir, reportFiles[reportFiles.length - 2]!)
  const currentFile = resolve(targetDir, reportFiles[reportFiles.length - 1]!)
  return { baselineFile, currentFile }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
