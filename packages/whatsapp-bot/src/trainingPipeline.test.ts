import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  applyAcceptedProposals,
  buildImprovementProposals,
  buildGeneratedDialogueSeeds,
  compileDialogueSeeds,
  runDialogueSeeds,
} from "./trainingPipeline.js"
import { IntentExtractionService } from "./intentExtractionService.js"
import { ReferenceResolutionService } from "./referenceResolutionService.js"
import { ShoppingRouter } from "./shoppingRouter.js"
import { ContextGovernanceService } from "./contextGovernanceService.js"

test("training pipeline compiles multi-turn dialogues into eval cases", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-dialogues-"))
  const seedFile = join(dir, "dialogues.json")
  await writeFile(
    seedFile,
    JSON.stringify([
      {
        dialogue_id: "dlg-1",
        name: "Milch browse",
        turns: [
          { role: "assistant", message: "Was brauchst du?" },
          {
            role: "user",
            message: "Ich brauche Milch",
            expected_intent: "browse_category",
            expected_route_kind: "browse_category",
            expected_family: "dairy",
            expected_should_clarify: false,
          },
        ],
      },
    ]),
    "utf8",
  )

  const cases = await compileDialogueSeeds(seedFile)
  assert.equal(cases.length, 1)
  assert.equal(cases[0]?.name, "Milch browse / turn 1")
  assert.match(String(cases[0]?.context_summary || ""), /assistant: Was brauchst du/)
})

test("training pipeline runs dialogue seeds into review entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-dialogues-run-"))
  const seedFile = join(dir, "dialogues.json")
  await writeFile(
    seedFile,
    JSON.stringify([
      {
        dialogue_id: "dlg-2",
        name: "Recipe switch",
        turns: [
          { role: "assistant", message: "Wie viele Flaschen Bier moechtest du?" },
          {
            role: "user",
            message: "Ich moechte Musaka kochen",
            expected_intent: "recipe_to_cart",
            expected_route_kind: "recipe_to_cart",
            expected_family: "musaka",
            expected_should_clarify: false,
          },
        ],
      },
    ]),
    "utf8",
  )

  const entries = await runDialogueSeeds({
    sourceFile: seedFile,
    intentExtractor: new IntentExtractionService(),
    referenceResolver: new ReferenceResolutionService(),
    shoppingRouter: new ShoppingRouter(),
    contextGovernanceService: new ContextGovernanceService(),
  })

  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.source, "dialogue_seed")
  assert.equal(entries[0]?.review_status, "pending")
  assert.equal(entries[0]?.expected_route_kind, "recipe_to_cart")
  assert.ok(Array.isArray(entries[0]?.failures))
})

test("training pipeline builds clustered improvement proposals from review entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-training-proposals-"))
  const reviewFile = join(dir, "review.json")
  await writeFile(
    reviewFile,
    JSON.stringify([
      {
        case_id: "case-1",
        source: "dialogue_seed",
        name: "Milk append failed",
        message: "Ich brauche auch Milch",
        expected_family: "milchprodukte",
        failure_bucket: "wrong_selection_mode",
        failures: ["selection_mode expected=add_to_existing_cart actual=replace_with_single_product"],
        review_status: "pending",
      },
      {
        case_id: "case-2",
        source: "dialogue_seed",
        name: "Milk append failed again",
        message: "auch Vollmilch",
        expected_family: "milchprodukte",
        failure_bucket: "wrong_selection_mode",
        failures: ["selection_mode expected=add_to_existing_cart actual=replace_with_single_product"],
        review_status: "pending",
      },
    ]),
    "utf8",
  )

  const proposals = await buildImprovementProposals(reviewFile)
  assert.equal(proposals.length, 1)
  assert.equal(proposals[0]?.failure_bucket, "wrong_selection_mode")
  assert.equal(proposals[0]?.family, "milchprodukte")
  assert.match(String(proposals[0]?.suggested_guard_phrases[0] || ""), /append|replace/)
  assert.ok((proposals[0]?.example_messages || []).includes("Ich brauche auch Milch"))
})

test("training pipeline generates more than 1000 replayable german user turns", async () => {
  const dialogues = buildGeneratedDialogueSeeds()
  let userTurns = 0
  for (const dialogue of dialogues) {
    for (const turn of dialogue.turns) {
      if (turn.role === "user") userTurns += 1
    }
  }
  assert.ok(userTurns >= 1000)
})

test("training pipeline applies accepted proposals into accepted training config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-training-accepted-"))
  const proposalFile = join(dir, "proposals.json")
  const acceptedFile = join(dir, "accepted.json")
  await writeFile(
    proposalFile,
    JSON.stringify([
      {
        proposal_id: "proposal-wrong-selection-mode-milchprodukte",
        failure_bucket: "wrong_selection_mode",
        family: "milchprodukte",
        example_messages: ["Ich brauche auch Buttermilch"],
        affected_case_ids: ["case-1"],
        suggested_aliases: ["Buttermilch"],
        suggested_guard_phrases: ["auch X -> append"],
        suggested_prompt_examples: ['Message: "Ich brauche auch Buttermilch" -> selection_mode should be append'],
        suggested_seed_cases: ["seed:wrong_selection_mode:milchprodukte:1:Ich brauche auch Buttermilch"],
        notes: ["clustered"],
        review_status: "accepted",
      },
    ]),
    "utf8",
  )

  const merged = await applyAcceptedProposals({
    proposalFile,
    acceptedFile,
  })

  assert.deepEqual(merged.accepted_aliases_by_family.milchprodukte, ["Buttermilch"])
  assert.equal(merged.accepted_seed_dialogues.length, 1)
  assert.match(String(merged.accepted_seed_dialogues[0]?.dialogue_id || ""), /accepted-wrong_selection_mode-milchprodukte/)
  assert.equal(merged.accepted_prompt_examples.length, 1)
})
