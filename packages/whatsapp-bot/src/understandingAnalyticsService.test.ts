import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FileStateStore } from "./stateStore.js"
import { UnderstandingAnalyticsService } from "./understandingAnalyticsService.js"
import { IntentExtractionService } from "./intentExtractionService.js"
import { ReferenceResolutionService } from "./referenceResolutionService.js"
import { ShoppingRouter } from "./shoppingRouter.js"
import { ContextGovernanceService } from "./contextGovernanceService.js"
import {
  buildEvalDiffReport,
  buildEvalReport,
  renderEvalDiffSummary,
  renderEvalSummary,
} from "./understandingAnalyticsService.js"

test("understanding analytics records events and replays eval cases", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-understanding-"))
  const store = new FileStateStore(join(dir, "state.sqlite"))
  const analytics = new UnderstandingAnalyticsService(store)

  await analytics.recordTurn({
    subjectId: "user:1",
    channel: "whatsapp",
    userMessage: "ich brauche klopapier",
    snapshot: { subjectId: "user:1", profile: { activeEditMode: "add_to_existing_cart" } },
    contextSummary: "history=user: hallo",
    extraction: {
      primary_intent: "browse_category",
      secondary_intents: [],
      confidence: 0.8,
      task_type: "shopping",
      dialogue_move: "new_request",
      selection_mode: "browse_only",
      context_relation: "use_current",
      reference_strength: "none",
      clarification_needed: false,
      clarification_reason: null,
      needs_clarification: false,
      clarification_question: null,
      categories: ["household_paper"],
      product_queries: [],
      recipe_request: null,
      cart_action: null,
      references_to_previous_context: {
        has_reference: false,
        reference_type: null,
        reference_value: null,
      },
    },
    route: { kind: "browse_category" },
    referenceResolution: { status: "none", clarificationQuestion: null },
    governance: {
      valid_context_sources: ["current_flow"],
      discarded_context_sources: [],
      pending_question_still_valid: false,
      stale_context_conflict: false,
      active_anchor: null,
      repair_mode: false,
      repair_reason: null,
      should_clear_active_product: false,
      should_clear_pending_options: false,
      should_clear_pending_clarification: false,
    },
  })

  const exportedFile = join(dir, "cases.json")
  const exportedCount = await analytics.writeRecentCasesToFile({
    outFile: exportedFile,
    limit: 10,
  })
  assert.equal(exportedCount, 1)

  const exported = JSON.parse(await readFile(exportedFile, "utf8")) as Array<Record<string, unknown>>
  assert.equal(exported[0]?.expected_route_kind, "browse_category")
  assert.equal(exported[0]?.expected_should_clarify, false)
  assert.equal(exported[0]?.expected_family, "household_paper")
  assert.equal(exported[0]?.suggested_failure_bucket, "wrong_selection_mode")
  assert.match(String(exported[0]?.governance_summary || ""), /pending_valid=false/)
  assert.equal(exported[0]?.expected_selection_mode, undefined)

  await analytics.importCasesFromFile(exportedFile)

  const summary = await analytics.runEval({
    intentExtractor: new IntentExtractionService(),
    referenceResolver: new ReferenceResolutionService(),
    shoppingRouter: new ShoppingRouter(),
    contextGovernanceService: new ContextGovernanceService(),
  })

  assert.equal(summary.total, 1)
  assert.equal(summary.passed, 1)
  assert.equal(summary.results[0]?.actual_intent, "browse_category")
  assert.match(renderEvalSummary(summary), /Family scorecard:/)
  assert.match(renderEvalSummary(summary), /household_paper: 1\/1 passed/)
  assert.doesNotMatch(renderEvalSummary(summary), /Failure bucket scorecard:/)
  assert.doesNotMatch(renderEvalSummary(summary), /Failed by family:/i)
})

test("eval summary groups failures by bucket", () => {
  const summary = renderEvalSummary({
    total: 2,
    passed: 0,
    failed: 2,
    results: [
      {
        caseId: "case-1",
        name: "append meat",
        ok: false,
        failures: ["selection_mode expected=add_to_existing_cart actual=replace_with_single_product"],
        expected_family: "fleisch",
        severity: "selection_mode",
        actual_intent: "browse_category",
        actual_route_kind: "browse_category",
        actual_route_action: undefined,
        actual_selection_mode: "replace_with_single_product",
        actual_should_clarify: false,
        actual_family: "fleisch",
        actual_categories: ["fleisch"],
        catastrophic_mismatch_detected: false,
        failure_bucket: "wrong_selection_mode",
      },
      {
        caseId: "case-2",
        name: "recipe stale hijack",
        ok: false,
        failures: ["intent expected=recipe_to_cart actual=search_product"],
        expected_family: "reis",
        severity: "intent",
        actual_intent: "search_product",
        actual_route_kind: "search_product",
        actual_route_action: undefined,
        actual_selection_mode: undefined,
        actual_should_clarify: false,
        actual_family: "household_paper",
        actual_categories: ["household_paper"],
        catastrophic_mismatch_detected: true,
        failure_bucket: "stale_context_hijack",
      },
    ],
  })

  assert.match(summary, /Failure bucket scorecard:/)
  assert.match(summary, /wrong_selection_mode: 1 failed/)
  assert.match(summary, /stale_context_hijack: 1 failed \(1 catastrophic\)/)
  assert.match(summary, /Failed by bucket:/)
})

test("eval report exposes machine-readable scorecards", () => {
  const report = buildEvalReport({
    total: 2,
    passed: 1,
    failed: 1,
    results: [
      {
        caseId: "case-1",
        name: "append meat",
        ok: false,
        failures: ["selection_mode expected=add_to_existing_cart actual=replace_with_single_product"],
        expected_family: "fleisch",
        severity: "selection_mode",
        actual_intent: "browse_category",
        actual_route_kind: "browse_category",
        actual_route_action: undefined,
        actual_selection_mode: "replace_with_single_product",
        actual_should_clarify: false,
        actual_family: "fleisch",
        actual_categories: ["fleisch"],
        catastrophic_mismatch_detected: false,
        failure_bucket: "wrong_selection_mode",
      },
      {
        caseId: "case-2",
        name: "milk browse",
        ok: true,
        failures: [],
        expected_family: "dairy",
        severity: "other",
        actual_intent: "browse_category",
        actual_route_kind: "browse_category",
        actual_route_action: undefined,
        actual_selection_mode: undefined,
        actual_should_clarify: false,
        actual_family: "dairy",
        actual_categories: ["dairy"],
        catastrophic_mismatch_detected: false,
        failure_bucket: "other",
      },
    ],
  })

  assert.equal(report.totals.total, 2)
  assert.equal(report.totals.failed, 1)
  assert.equal(report.family_scorecard[0]?.family, "fleisch")
  assert.equal(report.failure_bucket_scorecard[0]?.bucket, "wrong_selection_mode")
  assert.equal(report.failed_by_bucket[0]?.bucket, "wrong_selection_mode")
  assert.equal(report.failed_by_family[0]?.family, "fleisch")
})

test("eval diff report compares bucket and family trends", () => {
  const baseline = buildEvalReport({
    total: 2,
    passed: 1,
    failed: 1,
    results: [
      {
        caseId: "case-1",
        name: "append meat",
        ok: false,
        failures: ["selection_mode expected=add_to_existing_cart actual=replace_with_single_product"],
        expected_family: "fleisch",
        severity: "selection_mode",
        actual_intent: "browse_category",
        actual_route_kind: "browse_category",
        actual_route_action: undefined,
        actual_selection_mode: "replace_with_single_product",
        actual_should_clarify: false,
        actual_family: "fleisch",
        actual_categories: ["fleisch"],
        catastrophic_mismatch_detected: false,
        failure_bucket: "wrong_selection_mode",
      },
      {
        caseId: "case-2",
        name: "milk browse",
        ok: true,
        failures: [],
        expected_family: "dairy",
        severity: "other",
        actual_intent: "browse_category",
        actual_route_kind: "browse_category",
        actual_route_action: undefined,
        actual_selection_mode: undefined,
        actual_should_clarify: false,
        actual_family: "dairy",
        actual_categories: ["dairy"],
        catastrophic_mismatch_detected: false,
        failure_bucket: "other",
      },
    ],
  })
  const current = buildEvalReport({
    total: 3,
    passed: 1,
    failed: 2,
    results: [
      {
        caseId: "case-1",
        name: "append meat",
        ok: false,
        failures: ["selection_mode expected=add_to_existing_cart actual=replace_with_single_product"],
        expected_family: "fleisch",
        severity: "selection_mode",
        actual_intent: "browse_category",
        actual_route_kind: "browse_category",
        actual_route_action: undefined,
        actual_selection_mode: "replace_with_single_product",
        actual_should_clarify: false,
        actual_family: "fleisch",
        actual_categories: ["fleisch"],
        catastrophic_mismatch_detected: false,
        failure_bucket: "wrong_selection_mode",
      },
      {
        caseId: "case-2",
        name: "milk browse",
        ok: true,
        failures: [],
        expected_family: "dairy",
        severity: "other",
        actual_intent: "browse_category",
        actual_route_kind: "browse_category",
        actual_route_action: undefined,
        actual_selection_mode: undefined,
        actual_should_clarify: false,
        actual_family: "dairy",
        actual_categories: ["dairy"],
        catastrophic_mismatch_detected: false,
        failure_bucket: "other",
      },
      {
        caseId: "case-3",
        name: "stale recipe switch",
        ok: false,
        failures: ["intent expected=recipe_to_cart actual=search_product"],
        expected_family: "musaka",
        severity: "intent",
        actual_intent: "search_product",
        actual_route_kind: "search_product",
        actual_route_action: undefined,
        actual_selection_mode: undefined,
        actual_should_clarify: false,
        actual_family: "household_paper",
        actual_categories: ["household_paper"],
        catastrophic_mismatch_detected: true,
        failure_bucket: "stale_context_hijack",
      },
    ],
  })

  const diff = buildEvalDiffReport({ baseline, current })
  assert.equal(diff.totals.total_delta, 1)
  assert.equal(diff.totals.failed_delta, 1)
  assert.equal(diff.failure_bucket_deltas[0]?.bucket, "stale_context_hijack")
  assert.match(renderEvalDiffSummary(diff), /Understanding eval diff:/)
  assert.match(renderEvalDiffSummary(diff), /stale_context_hijack: failed \+1, catastrophic \+1/)
})
