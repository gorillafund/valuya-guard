import { randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { IntentExtractionService, IntentExtraction } from "./intentExtractionService.js"
import type { ConversationSnapshot } from "./conversationStateService.js"
import type { ReferenceResolutionService, ReferenceResolution } from "./referenceResolutionService.js"
import type { ShoppingRouter, ShoppingRoute } from "./shoppingRouter.js"
import type { ContextGovernanceService, ContextGovernanceResult } from "./contextGovernanceService.js"
import type {
  FileStateStore,
  StoredUnderstandingEvalCase,
  StoredUnderstandingEvent,
} from "./stateStore.js"

export type UnderstandingEvalCaseFile = {
  case_id?: string
  name: string
  message: string
  context_summary?: string
  expected_intent?: string
  expected_route_kind?: string
  expected_route_action?: string
  expected_selection_mode?: "replace_with_single_product" | "add_to_existing_cart"
  expected_should_clarify?: boolean
  expected_family?: string
  expected_categories?: string[]
  catastrophic_mismatch?: boolean
  suggested_failure_bucket?: string
  governance_summary?: string
  notes?: string
}

export type UnderstandingEvalResult = {
  caseId: string
  name: string
  ok: boolean
  failures: string[]
  expected_family?: string
  severity: "catastrophic" | "selection_mode" | "clarification" | "family" | "intent" | "other"
  actual_intent: string
  actual_route_kind: string
  actual_route_action?: string
  actual_selection_mode?: "replace_with_single_product" | "add_to_existing_cart"
  actual_should_clarify: boolean
  actual_family?: string
  actual_categories: string[]
  catastrophic_mismatch_detected: boolean
  failure_bucket: string
}

export type UnderstandingEvalReport = {
  totals: {
    total: number
    passed: number
    failed: number
    catastrophic: number
  }
  family_scorecard: Array<{
    family: string
    passed: number
    total: number
    catastrophic: number
  }>
  failure_bucket_scorecard: Array<{
    bucket: string
    failed: number
    catastrophic: number
  }>
  failed_by_family: Array<{
    family: string
    count: number
    results: Array<{
      caseId: string
      name: string
      severity: UnderstandingEvalResult["severity"]
      failure_bucket: string
      failures: string[]
    }>
  }>
  failed_by_bucket: Array<{
    bucket: string
    count: number
    results: Array<{
      caseId: string
      name: string
      severity: UnderstandingEvalResult["severity"]
      expected_family?: string
      failures: string[]
    }>
  }>
}

export type UnderstandingEvalDiffReport = {
  totals: {
    total_delta: number
    passed_delta: number
    failed_delta: number
    catastrophic_delta: number
  }
  family_deltas: Array<{
    family: string
    total_delta: number
    passed_delta: number
    catastrophic_delta: number
  }>
  failure_bucket_deltas: Array<{
    bucket: string
    failed_delta: number
    catastrophic_delta: number
  }>
}

export class UnderstandingAnalyticsService {
  constructor(private readonly store: FileStateStore) {}

  async recordTurn(args: {
    subjectId: string
    channel: string
    userMessage: string
    snapshot: ConversationSnapshot
    contextSummary?: string
    extraction: IntentExtraction
    route: ShoppingRoute
    referenceResolution: ReferenceResolution
    governance: ContextGovernanceResult
  }): Promise<void> {
    const event: StoredUnderstandingEvent = {
      event_id: randomUUID(),
      subject_id: args.subjectId,
      channel: args.channel,
      user_message: args.userMessage,
      context_summary: args.contextSummary?.trim() || undefined,
      extraction_json: args.extraction as unknown as Record<string, unknown>,
      route_kind: args.route.kind,
      route_action: "action" in args.route ? args.route.action : undefined,
      reference_status: args.referenceResolution.status,
      pending_options_kind: args.snapshot.profile?.pendingOptions?.kind,
      active_edit_mode: args.snapshot.profile?.activeEditMode,
      feedback_signal: inferFeedbackSignal(args.userMessage),
      created_at: new Date().toISOString(),
    }
    if (event.extraction_json) {
      event.extraction_json.governance = args.governance as unknown as Record<string, unknown>
    }
    await this.store.appendUnderstandingEvent(event)
  }

  async exportRecentCases(args?: {
    limit?: number
    feedbackOnly?: boolean
  }): Promise<UnderstandingEvalCaseFile[]> {
    const events = await this.store.listUnderstandingEvents(args)
    return events.map((event) => buildSuggestedCase(event))
  }

  async writeRecentCasesToFile(args: {
    outFile: string
    limit?: number
    feedbackOnly?: boolean
  }): Promise<number> {
    const cases = await this.exportRecentCases({
      limit: args.limit,
      feedbackOnly: args.feedbackOnly,
    })
    const target = resolve(args.outFile)
    await writeFile(target, `${JSON.stringify(cases, null, 2)}\n`, "utf8")
    return cases.length
  }

  async importCasesFromFile(filePath: string): Promise<number> {
    const raw = await readFile(resolve(filePath), "utf8")
    const parsed = JSON.parse(raw) as UnderstandingEvalCaseFile[]
    let count = 0
    for (const entry of parsed) {
      const name = String(entry.name || "").trim()
      const message = String(entry.message || "").trim()
      if (!name || !message) continue
      await this.store.upsertUnderstandingEvalCase({
        case_id: entry.case_id?.trim() || slugify(name),
        name,
        message,
        context_summary: entry.context_summary,
        expected_intent: entry.expected_intent,
        expected_route_kind: entry.expected_route_kind,
        expected_route_action: entry.expected_route_action,
        expected_selection_mode: entry.expected_selection_mode,
        expected_should_clarify: entry.expected_should_clarify,
        expected_family: entry.expected_family,
        expected_categories: entry.expected_categories,
        catastrophic_mismatch: entry.catastrophic_mismatch,
        notes: entry.notes,
      })
      count += 1
    }
    return count
  }

  async runEval(args: {
    intentExtractor: IntentExtractionService
    referenceResolver: ReferenceResolutionService
    shoppingRouter: ShoppingRouter
    contextGovernanceService: ContextGovernanceService
    limit?: number
  }): Promise<{
    total: number
    passed: number
    failed: number
    results: UnderstandingEvalResult[]
  }> {
    const cases = await this.store.listUnderstandingEvalCases(args.limit)
    const results: UnderstandingEvalResult[] = []
    for (const testCase of cases) {
      const extraction = await args.intentExtractor.extract({
        message: testCase.message,
        contextSummary: testCase.context_summary,
      })
      const referenceResolution = args.referenceResolver.resolve({
        extraction,
        snapshot: { subjectId: "eval-case", profile: undefined, conversation: undefined },
      })
      const governance = args.contextGovernanceService.evaluate({
        extraction,
        snapshot: { subjectId: "eval-case", profile: undefined, conversation: undefined },
      })
      const route = args.shoppingRouter.route({ extraction, referenceResolution, governance })
      const failures: string[] = []
      const actualSelectionMode = inferSelectionMode(testCase.message, testCase.context_summary)
      const actualShouldClarify = route.kind === "clarify" || route.kind === "unknown"
      const actualFamily = inferFamily(extraction)
      const catastrophicMismatchDetected = detectCatastrophicMismatch({
        testCase,
        actualFamily,
        actualShouldClarify,
      })
      if (testCase.expected_intent && extraction.primary_intent !== testCase.expected_intent) {
        failures.push(`intent expected=${testCase.expected_intent} actual=${extraction.primary_intent}`)
      }
      if (testCase.expected_route_kind && route.kind !== testCase.expected_route_kind) {
        failures.push(`route expected=${testCase.expected_route_kind} actual=${route.kind}`)
      }
      const routeAction = "action" in route ? route.action : undefined
      if (testCase.expected_route_action && routeAction !== testCase.expected_route_action) {
        failures.push(`route_action expected=${testCase.expected_route_action} actual=${routeAction || "none"}`)
      }
      if (testCase.expected_selection_mode && actualSelectionMode !== testCase.expected_selection_mode) {
        failures.push(`selection_mode expected=${testCase.expected_selection_mode} actual=${actualSelectionMode || "none"}`)
      }
      if (typeof testCase.expected_should_clarify === "boolean" && actualShouldClarify !== testCase.expected_should_clarify) {
        failures.push(`should_clarify expected=${testCase.expected_should_clarify} actual=${actualShouldClarify}`)
      }
      if (testCase.expected_family && actualFamily !== normalizeValue(testCase.expected_family)) {
        failures.push(`family expected=${normalizeValue(testCase.expected_family)} actual=${actualFamily || "none"}`)
      }
      if (testCase.expected_categories?.length) {
        const actual = extraction.categories.map(normalizeValue)
        const missing = testCase.expected_categories
          .map(normalizeValue)
          .filter((expected) => !actual.includes(expected))
        if (missing.length) {
          failures.push(`categories missing=${missing.join(",")}`)
        }
      }
      if (testCase.catastrophic_mismatch === true && catastrophicMismatchDetected) {
        failures.push("catastrophic_mismatch_detected=true")
      }
      results.push({
        caseId: testCase.case_id,
        name: testCase.name,
        ok: failures.length === 0,
        failures,
        expected_family: testCase.expected_family,
        severity: classifySeverity({
          failures,
          catastrophicMismatchDetected,
        }),
        actual_intent: extraction.primary_intent,
        actual_route_kind: route.kind,
        actual_route_action: routeAction,
        actual_selection_mode: actualSelectionMode,
        actual_should_clarify: actualShouldClarify,
        actual_family: actualFamily,
        actual_categories: extraction.categories,
        catastrophic_mismatch_detected: catastrophicMismatchDetected,
        failure_bucket: classifyFailureBucket({
          failures,
          catastrophicMismatchDetected,
          governance,
        }),
      })
    }
    const passed = results.filter((result) => result.ok).length
    return {
      total: results.length,
      passed,
      failed: results.length - passed,
      results,
    }
  }
}

export function renderEvalSummary(summary: {
  total: number
  passed: number
  failed: number
  results: UnderstandingEvalResult[]
}): string {
  const lines = [
    `Understanding eval: ${summary.passed}/${summary.total} passed`,
  ]
  const byFamily = buildFamilyScorecard(summary.results)
  if (byFamily.length) {
    lines.push("")
    lines.push("Family scorecard:")
    for (const entry of byFamily) {
      lines.push(`- ${entry.family}: ${entry.passed}/${entry.total} passed (${entry.total - entry.passed} failed, ${entry.catastrophic} catastrophic)`)
    }
  }
  const byBucket = buildFailureBucketScorecard(summary.results)
  if (byBucket.length) {
    lines.push("")
    lines.push("Failure bucket scorecard:")
    for (const entry of byBucket) {
      lines.push(`- ${entry.bucket}: ${entry.failed} failed (${entry.catastrophic} catastrophic)`)
    }
  }
  const catastrophic = summary.results.filter((entry) => entry.catastrophic_mismatch_detected)
  if (catastrophic.length) {
    lines.push("")
    lines.push(`Catastrophic mismatches detected: ${catastrophic.length}`)
  }
  const failedResults = [...summary.results.filter((entry) => !entry.ok)].sort(compareSeverity)
  for (const result of failedResults.slice(0, 20)) {
    lines.push(`- [${result.severity}/${result.failure_bucket}] ${result.caseId} (${result.name}): ${result.failures.join("; ")}`)
  }
  const failedByFamily = buildFailedByFamily(failedResults)
  if (failedByFamily.length) {
    lines.push("")
    lines.push("Failed by family:")
    for (const family of failedByFamily) {
      lines.push(`- ${family.family}: ${family.count} failed`)
      for (const result of family.results.slice(0, 5)) {
        lines.push(`  ${result.severity}: ${result.name}`)
      }
    }
  }
  const failedByBucket = buildFailedByBucket(failedResults)
  if (failedByBucket.length) {
    lines.push("")
    lines.push("Failed by bucket:")
    for (const bucket of failedByBucket) {
      lines.push(`- ${bucket.bucket}: ${bucket.count} failed`)
      for (const result of bucket.results.slice(0, 5)) {
        lines.push(`  ${result.severity}: ${result.name}`)
      }
    }
  }
  return lines.join("\n")
}

export function buildEvalReport(summary: {
  total: number
  passed: number
  failed: number
  results: UnderstandingEvalResult[]
}): UnderstandingEvalReport {
  return {
    totals: {
      total: summary.total,
      passed: summary.passed,
      failed: summary.failed,
      catastrophic: summary.results.filter((entry) => entry.catastrophic_mismatch_detected).length,
    },
    family_scorecard: buildFamilyScorecard(summary.results),
    failure_bucket_scorecard: buildFailureBucketScorecard(summary.results),
    failed_by_family: buildFailedByFamily(summary.results.filter((entry) => !entry.ok)).map((family) => ({
      family: family.family,
      count: family.count,
      results: family.results.map((result) => ({
        caseId: result.caseId,
        name: result.name,
        severity: result.severity,
        failure_bucket: result.failure_bucket,
        failures: result.failures,
      })),
    })),
    failed_by_bucket: buildFailedByBucket(summary.results.filter((entry) => !entry.ok)).map((bucket) => ({
      bucket: bucket.bucket,
      count: bucket.count,
      results: bucket.results.map((result) => ({
        caseId: result.caseId,
        name: result.name,
        severity: result.severity,
        expected_family: result.expected_family,
        failures: result.failures,
      })),
    })),
  }
}

export function buildEvalDiffReport(args: {
  baseline: UnderstandingEvalReport
  current: UnderstandingEvalReport
}): UnderstandingEvalDiffReport {
  return {
    totals: {
      total_delta: args.current.totals.total - args.baseline.totals.total,
      passed_delta: args.current.totals.passed - args.baseline.totals.passed,
      failed_delta: args.current.totals.failed - args.baseline.totals.failed,
      catastrophic_delta: args.current.totals.catastrophic - args.baseline.totals.catastrophic,
    },
    family_deltas: buildFamilyScorecardDeltas({
      baseline: args.baseline.family_scorecard,
      current: args.current.family_scorecard,
    }),
    failure_bucket_deltas: buildFailureBucketScorecardDeltas({
      baseline: args.baseline.failure_bucket_scorecard,
      current: args.current.failure_bucket_scorecard,
    }),
  }
}

export function renderEvalDiffSummary(diff: UnderstandingEvalDiffReport): string {
  const lines = [
    "Understanding eval diff:",
    `- totals: total ${formatDelta(diff.totals.total_delta)}, passed ${formatDelta(diff.totals.passed_delta)}, failed ${formatDelta(diff.totals.failed_delta)}, catastrophic ${formatDelta(diff.totals.catastrophic_delta)}`,
  ]
  if (diff.family_deltas.length) {
    lines.push("")
    lines.push("Family deltas:")
    for (const entry of diff.family_deltas) {
      lines.push(`- ${entry.family}: passed ${formatDelta(entry.passed_delta)}, total ${formatDelta(entry.total_delta)}, catastrophic ${formatDelta(entry.catastrophic_delta)}`)
    }
  }
  if (diff.failure_bucket_deltas.length) {
    lines.push("")
    lines.push("Failure bucket deltas:")
    for (const entry of diff.failure_bucket_deltas) {
      lines.push(`- ${entry.bucket}: failed ${formatDelta(entry.failed_delta)}, catastrophic ${formatDelta(entry.catastrophic_delta)}`)
    }
  }
  return lines.join("\n")
}

function buildSuggestedCase(event: StoredUnderstandingEvent): UnderstandingEvalCaseFile {
  const extraction = event.extraction_json || {}
  const categories = Array.isArray(extraction.categories)
    ? extraction.categories.map((value) => String(value || "")).filter(Boolean)
    : undefined
  return {
    case_id: `event-${event.event_id}`,
    name: `${event.channel}:${event.user_message.slice(0, 48)}`,
    message: event.user_message,
    context_summary: event.context_summary,
    expected_intent: typeof extraction.primary_intent === "string" ? extraction.primary_intent : undefined,
    expected_route_kind: event.route_kind || undefined,
    expected_route_action: event.route_action || undefined,
    expected_selection_mode: inferSelectionMode(event.user_message, event.context_summary),
    expected_should_clarify:
      event.route_kind === "clarify" || event.route_kind === "unknown"
        ? true
        : false,
    expected_family: inferFamilyFromExtractionJson(extraction),
    expected_categories: categories?.length ? categories : undefined,
    catastrophic_mismatch: event.feedback_signal === "correction" ? true : undefined,
    suggested_failure_bucket: inferSuggestedFailureBucket(event),
    governance_summary: summarizeGovernance(extraction.governance),
    notes: event.feedback_signal
      ? `review suggested; feedback_signal=${event.feedback_signal}; governance=${summarizeGovernance(extraction.governance)}`
      : "review suggested",
  }
}

function inferFeedbackSignal(message: string): string | undefined {
  const normalized = normalizeValue(message)
  if (!normalized) return undefined
  if (/\b(nein|not that|falsch|wrong|ich meine|meinte|nicht das)\b/.test(normalized)) {
    return "correction"
  }
  if (/\b(mehr|noch mehr|weiter|andere|alternativen?)\b/.test(normalized)) {
    return "refinement"
  }
  return undefined
}

function normalizeValue(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function slugify(value: string): string {
  return normalizeValue(value).replace(/\s+/g, "-").slice(0, 80) || randomUUID()
}

function buildFamilyScorecard(results: UnderstandingEvalResult[]): Array<{
  family: string
  passed: number
  total: number
  catastrophic: number
}> {
  const grouped = new Map<string, { family: string; passed: number; total: number; catastrophic: number }>()
  for (const result of results) {
    const family = result.expected_family ? normalizeValue(result.expected_family) : ""
    if (!family) continue
    const current = grouped.get(family) || { family, passed: 0, total: 0, catastrophic: 0 }
    current.total += 1
    if (result.ok) current.passed += 1
    if (result.catastrophic_mismatch_detected) current.catastrophic += 1
    grouped.set(family, current)
  }
  return [...grouped.values()].sort((a, b) =>
    a.passed / Math.max(a.total, 1) - b.passed / Math.max(b.total, 1) || b.total - a.total || a.family.localeCompare(b.family),
  )
}

function buildFailedByFamily(results: UnderstandingEvalResult[]): Array<{
  family: string
  count: number
  results: UnderstandingEvalResult[]
}> {
  const grouped = new Map<string, UnderstandingEvalResult[]>()
  for (const result of results) {
    const family = result.expected_family ? normalizeValue(result.expected_family) : "uncategorized"
    const list = grouped.get(family) || []
    list.push(result)
    grouped.set(family, list)
  }
  return [...grouped.entries()]
    .map(([family, familyResults]) => ({
      family,
      count: familyResults.length,
      results: [...familyResults].sort(compareSeverity),
    }))
    .sort((a, b) => b.count - a.count || a.family.localeCompare(b.family))
}

function buildFailureBucketScorecard(results: UnderstandingEvalResult[]): Array<{
  bucket: string
  failed: number
  catastrophic: number
}> {
  const grouped = new Map<string, { bucket: string; failed: number; catastrophic: number }>()
  for (const result of results) {
    if (result.ok) continue
    const bucket = result.failure_bucket || "other"
    const current = grouped.get(bucket) || { bucket, failed: 0, catastrophic: 0 }
    current.failed += 1
    if (result.catastrophic_mismatch_detected) current.catastrophic += 1
    grouped.set(bucket, current)
  }
  return [...grouped.values()].sort((a, b) =>
    b.failed - a.failed || b.catastrophic - a.catastrophic || a.bucket.localeCompare(b.bucket),
  )
}

function buildFailedByBucket(results: UnderstandingEvalResult[]): Array<{
  bucket: string
  count: number
  results: UnderstandingEvalResult[]
}> {
  const grouped = new Map<string, UnderstandingEvalResult[]>()
  for (const result of results) {
    const bucket = result.failure_bucket || "other"
    const list = grouped.get(bucket) || []
    list.push(result)
    grouped.set(bucket, list)
  }
  return [...grouped.entries()]
    .map(([bucket, bucketResults]) => ({
      bucket,
      count: bucketResults.length,
      results: [...bucketResults].sort(compareSeverity),
    }))
    .sort((a, b) => b.count - a.count || a.bucket.localeCompare(b.bucket))
}

function buildFamilyScorecardDeltas(args: {
  baseline: UnderstandingEvalReport["family_scorecard"]
  current: UnderstandingEvalReport["family_scorecard"]
}): UnderstandingEvalDiffReport["family_deltas"] {
  const merged = new Map<string, UnderstandingEvalDiffReport["family_deltas"][number]>()
  for (const entry of args.baseline) {
    merged.set(entry.family, {
      family: entry.family,
      total_delta: -entry.total,
      passed_delta: -entry.passed,
      catastrophic_delta: -entry.catastrophic,
    })
  }
  for (const entry of args.current) {
    const row = merged.get(entry.family) || {
      family: entry.family,
      total_delta: 0,
      passed_delta: 0,
      catastrophic_delta: 0,
    }
    row.total_delta += entry.total
    row.passed_delta += entry.passed
    row.catastrophic_delta += entry.catastrophic
    merged.set(entry.family, row)
  }
  return [...merged.values()]
    .filter((row) => row.total_delta !== 0 || row.passed_delta !== 0 || row.catastrophic_delta !== 0)
    .sort((a, b) =>
      Math.abs(b.passed_delta) - Math.abs(a.passed_delta)
        || Math.abs(b.total_delta) - Math.abs(a.total_delta)
        || a.family.localeCompare(b.family),
    )
}

function buildFailureBucketScorecardDeltas(args: {
  baseline: UnderstandingEvalReport["failure_bucket_scorecard"]
  current: UnderstandingEvalReport["failure_bucket_scorecard"]
}): UnderstandingEvalDiffReport["failure_bucket_deltas"] {
  const merged = new Map<string, UnderstandingEvalDiffReport["failure_bucket_deltas"][number]>()
  for (const entry of args.baseline) {
    merged.set(entry.bucket, {
      bucket: entry.bucket,
      failed_delta: -entry.failed,
      catastrophic_delta: -entry.catastrophic,
    })
  }
  for (const entry of args.current) {
    const row = merged.get(entry.bucket) || {
      bucket: entry.bucket,
      failed_delta: 0,
      catastrophic_delta: 0,
    }
    row.failed_delta += entry.failed
    row.catastrophic_delta += entry.catastrophic
    merged.set(entry.bucket, row)
  }
  return [...merged.values()]
    .filter((row) => row.failed_delta !== 0 || row.catastrophic_delta !== 0)
    .sort((a, b) =>
      Math.abs(b.failed_delta) - Math.abs(a.failed_delta)
        || Math.abs(b.catastrophic_delta) - Math.abs(a.catastrophic_delta)
        || a.bucket.localeCompare(b.bucket),
    )
}

function formatDelta(value: number): string {
  if (value > 0) return `+${value}`
  return String(value)
}

function classifySeverity(args: {
  failures: string[]
  catastrophicMismatchDetected: boolean
}): UnderstandingEvalResult["severity"] {
  if (args.catastrophicMismatchDetected) return "catastrophic"
  const joined = args.failures.join(" ; ")
  if (joined.includes("selection_mode")) return "selection_mode"
  if (joined.includes("should_clarify")) return "clarification"
  if (joined.includes("family") || joined.includes("categories missing")) return "family"
  if (joined.includes("intent") || joined.includes("route")) return "intent"
  return "other"
}

function classifyFailureBucket(args: {
  failures: string[]
  catastrophicMismatchDetected: boolean
  governance: ContextGovernanceResult
}): string {
  if (args.catastrophicMismatchDetected) return "catastrophic_mismatch"
  const joined = args.failures.join(" ; ")
  if (args.governance.repair_reason === "discard_stale_context" || args.governance.repair_reason === "topic_switch") {
    return "stale_context_hijack"
  }
  if (args.governance.repair_reason === "invalid_pending_question_grounding") {
    return "invalid_numeric_grounding"
  }
  if (joined.includes("selection_mode")) return "wrong_selection_mode"
  if (joined.includes("should_clarify")) return "should_have_clarified"
  if (joined.includes("family") || joined.includes("categories missing")) return "overconfident_sku_commitment"
  if (joined.includes("intent")) return "missed_correction"
  return "other"
}

function compareSeverity(a: UnderstandingEvalResult, b: UnderstandingEvalResult): number {
  return severityRank(a.severity) - severityRank(b.severity)
    || Number(b.catastrophic_mismatch_detected) - Number(a.catastrophic_mismatch_detected)
    || a.name.localeCompare(b.name)
}

function severityRank(value: UnderstandingEvalResult["severity"]): number {
  switch (value) {
    case "catastrophic":
      return 0
    case "selection_mode":
      return 1
    case "clarification":
      return 2
    case "family":
      return 3
    case "intent":
      return 4
    default:
      return 5
  }
}

function inferSelectionMode(
  message: string,
  contextSummary?: string,
): "replace_with_single_product" | "add_to_existing_cart" | undefined {
  const normalizedMessage = normalizeValue(message)
  const normalizedContext = normalizeValue(contextSummary || "")
  if (/\b(nur|statt|ersetze|tausche|umstellen|reduziere)\b/.test(normalizedMessage)) {
    return "replace_with_single_product"
  }
  if (/\b(auch|noch|zusatzlich|plus)\b/.test(normalizedMessage)) {
    return "add_to_existing_cart"
  }
  if (normalizedContext.includes("selected_recipe=") || normalizedContext.includes("last_shown=") || normalizedContext.includes("history=")) {
    if (/\b(kase|kaese|fleisch|getranke|getraenke|putzmittel|reinigungsmittel|baby|brot|gemuse|gemuese|pasta|reis|milchprodukte)\b/.test(normalizedMessage)) {
      return "add_to_existing_cart"
    }
  }
  return undefined
}

function inferFamily(extraction: IntentExtraction): string | undefined {
  const category = extraction.categories[0]
  if (category) return normalizeValue(category)
  const productName = extraction.product_queries[0]?.name
  return productName ? normalizeValue(productName) : undefined
}

function inferFamilyFromExtractionJson(extraction: Record<string, unknown>): string | undefined {
  const categories = Array.isArray(extraction.categories)
    ? extraction.categories.map((value) => String(value || "")).filter(Boolean)
    : []
  if (categories[0]) return normalizeValue(categories[0])
  const productQueries = Array.isArray(extraction.product_queries) ? extraction.product_queries : []
  const first = productQueries[0]
  if (!first || typeof first !== "object") return undefined
  const name = (first as Record<string, unknown>).name
  return typeof name === "string" && name.trim() ? normalizeValue(name) : undefined
}

function detectCatastrophicMismatch(args: {
  testCase: StoredUnderstandingEvalCase
  actualFamily?: string
  actualShouldClarify: boolean
}): boolean {
  if (!args.testCase.expected_family) return false
  const expectedFamily = normalizeValue(args.testCase.expected_family)
  if (!args.actualFamily) return !args.actualShouldClarify
  return args.actualFamily !== expectedFamily && !args.actualShouldClarify
}

function inferSuggestedFailureBucket(event: StoredUnderstandingEvent): string | undefined {
  const extraction = event.extraction_json || {}
  const governance = extraction.governance && typeof extraction.governance === "object"
    ? extraction.governance as Record<string, unknown>
    : null
  const repairReason = typeof governance?.repair_reason === "string" ? governance.repair_reason : ""
  if (repairReason === "discard_stale_context" || repairReason === "topic_switch") return "stale_context_hijack"
  if (repairReason === "invalid_pending_question_grounding") return "invalid_numeric_grounding"
  if (repairReason === "invalid_shown_options_grounding") return "invalid_yes_no_grounding"
  if (event.feedback_signal === "correction") return "missed_correction"
  if (event.route_kind === "clarify") return "should_have_clarified"
  if (event.active_edit_mode === "add_to_existing_cart" || event.active_edit_mode === "replace_with_single_product") {
    return "wrong_selection_mode"
  }
  return undefined
}

function summarizeGovernance(governance: unknown): string | undefined {
  if (!governance || typeof governance !== "object") return undefined
  const record = governance as Record<string, unknown>
  const parts: string[] = []
  if (typeof record.repair_reason === "string" && record.repair_reason.trim()) {
    parts.push(`repair=${record.repair_reason}`)
  }
  if (Array.isArray(record.discarded_context_sources) && record.discarded_context_sources.length) {
    parts.push(`discarded=${record.discarded_context_sources.join(",")}`)
  }
  if (typeof record.pending_question_still_valid === "boolean") {
    parts.push(`pending_valid=${record.pending_question_still_valid}`)
  }
  return parts.length ? parts.join(";") : undefined
}
