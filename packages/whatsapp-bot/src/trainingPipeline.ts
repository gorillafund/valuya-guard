import { readFile, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { basename, resolve } from "node:path"
import { FileStateStore, type StoredUnderstandingEvent } from "./stateStore.js"
import {
  UnderstandingAnalyticsService,
  type UnderstandingEvalCaseFile,
  type UnderstandingEvalResult,
} from "./understandingAnalyticsService.js"
import { IntentExtractionService } from "./intentExtractionService.js"
import { ReferenceResolutionService } from "./referenceResolutionService.js"
import { ShoppingRouter } from "./shoppingRouter.js"
import { ContextGovernanceService } from "./contextGovernanceService.js"

type DialogueTurn = {
  role: "user" | "assistant"
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
  notes?: string
}

type DialogueSeed = {
  dialogue_id: string
  name: string
  turns: DialogueTurn[]
}

type TrainingReviewEntry = {
  case_id: string
  source: "dialogue_seed" | "traffic_failure"
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
  actual_intent?: string
  actual_route_kind?: string
  actual_route_action?: string
  actual_selection_mode?: "replace_with_single_product" | "add_to_existing_cart"
  actual_should_clarify?: boolean
  actual_family?: string
  actual_categories?: string[]
  failure_bucket?: string
  failures?: string[]
  review_status: "pending"
  notes?: string
}

type TrainingImprovementProposal = {
  proposal_id: string
  failure_bucket: string
  family?: string
  example_messages: string[]
  affected_case_ids: string[]
  suggested_aliases: string[]
  suggested_guard_phrases: string[]
  suggested_prompt_examples: string[]
  suggested_seed_cases: string[]
  notes: string[]
  review_status: "pending"
}

type AcceptedTrainingConfig = {
  accepted_aliases_by_family: Record<string, string[]>
  accepted_seed_dialogues: DialogueSeed[]
  accepted_prompt_examples: string[]
}

type DialogueFamilyConfig = {
  family: string
  aliases: string[]
}

async function main(): Promise<void> {
  const [, , command = "", ...rest] = process.argv
  const stateFile =
    process.env.WHATSAPP_STATE_FILE?.trim() ||
    resolve(process.cwd(), ".data/whatsapp-state.sqlite")
  const store = new FileStateStore(stateFile)
  const analytics = new UnderstandingAnalyticsService(store)

  if (command === "seed-dialogues") {
    const sourceFile = rest[0] || resolve(process.cwd(), "dialogue-training.seed.json")
    const outFile = rest[1] || resolve(process.cwd(), ".data/dialogue-eval-cases.json")
    const cases = await compileDialogueSeeds(sourceFile)
    await writeJson(outFile, cases)
    console.log(`Wrote ${cases.length} dialogue eval cases to ${resolve(outFile)}`)
    return
  }

  if (command === "run-dialogues") {
    const sourceFile = rest[0] || resolve(process.cwd(), "dialogue-training.seed.json")
    const outFile = rest[1] || resolve(process.cwd(), ".data/dialogue-review.json")
    const entries = await runDialogueSeeds({
      sourceFile,
      intentExtractor: new IntentExtractionService({
        apiKey: process.env.OPENAI_API_KEY?.trim(),
        model: process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
      }),
      referenceResolver: new ReferenceResolutionService(),
      shoppingRouter: new ShoppingRouter(),
      contextGovernanceService: new ContextGovernanceService(),
    })
    await writeJson(outFile, entries)
    console.log(`Wrote ${entries.length} dialogue review entries to ${resolve(outFile)}`)
    return
  }

  if (command === "collect-failures") {
    const outFile = rest[0] || resolve(process.cwd(), ".data/training-review.json")
    const limit = parseOptionalInt(rest[1], 250)
    const entries = await buildTrainingReviewFromTraffic({
      analytics,
      store,
      limit,
    })
    await writeJson(outFile, entries)
    console.log(`Wrote ${entries.length} training review entries to ${resolve(outFile)}`)
    return
  }

  if (command === "propose-improvements") {
    const reviewFile = rest[0] || resolve(process.cwd(), ".data/training-review.json")
    const outFile = rest[1] || resolve(process.cwd(), ".data/training-proposals.json")
    const proposals = await buildImprovementProposals(reviewFile)
    await writeJson(outFile, proposals)
    console.log(`Wrote ${proposals.length} improvement proposals to ${resolve(outFile)}`)
    return
  }

  if (command === "apply-proposals") {
    const proposalFile = rest[0] || resolve(process.cwd(), ".data/training-proposals.json")
    const acceptedFile = rest[1] || resolve(process.cwd(), "training-accepted-proposals.json")
    const merged = await applyAcceptedProposals({
      proposalFile,
      acceptedFile,
    })
    await writeJson(acceptedFile, merged)
    console.log(`Updated accepted training config at ${resolve(acceptedFile)}`)
    return
  }

  console.log(
    [
      "Usage:",
      "  node dist/whatsapp-bot/src/trainingPipeline.js seed-dialogues [seedFile] [outFile]",
      "  node dist/whatsapp-bot/src/trainingPipeline.js run-dialogues [seedFile] [outFile]",
      "  node dist/whatsapp-bot/src/trainingPipeline.js collect-failures [outFile] [limit]",
      "  node dist/whatsapp-bot/src/trainingPipeline.js propose-improvements [reviewFile] [outFile]",
      "  node dist/whatsapp-bot/src/trainingPipeline.js apply-proposals [proposalFile] [acceptedFile]",
    ].join("\n"),
  )
}

export async function compileDialogueSeeds(seedFile: string): Promise<UnderstandingEvalCaseFile[]> {
  const dialogues = await readDialogueSeeds(seedFile)
  const cases: UnderstandingEvalCaseFile[] = []
  for (const dialogue of dialogues) {
    const history: string[] = []
    let userTurnIndex = 0
    for (const turn of dialogue.turns) {
      if (turn.role === "user") {
        userTurnIndex += 1
        cases.push({
          case_id: `${dialogue.dialogue_id}-turn-${userTurnIndex}`,
          name: `${dialogue.name} / turn ${userTurnIndex}`,
          message: turn.message,
          context_summary: turn.context_summary || summarizeHistory(history),
          expected_intent: turn.expected_intent,
          expected_route_kind: turn.expected_route_kind,
          expected_route_action: turn.expected_route_action,
          expected_selection_mode: turn.expected_selection_mode,
          expected_should_clarify: turn.expected_should_clarify,
          expected_family: turn.expected_family,
          expected_categories: turn.expected_categories,
          catastrophic_mismatch: turn.catastrophic_mismatch,
          notes: turn.notes,
        })
      }
      history.push(`${turn.role}: ${turn.message}`)
    }
  }
  return cases
}

export async function runDialogueSeeds(args: {
  sourceFile: string
  intentExtractor: IntentExtractionService
  referenceResolver: ReferenceResolutionService
  shoppingRouter: ShoppingRouter
  contextGovernanceService: ContextGovernanceService
}): Promise<TrainingReviewEntry[]> {
  const cases = await compileDialogueSeeds(args.sourceFile)
  const entries: TrainingReviewEntry[] = []
  for (const testCase of cases) {
    const extraction = await args.intentExtractor.extract({
      message: testCase.message,
      contextSummary: testCase.context_summary,
    })
    const referenceResolution = args.referenceResolver.resolve({
      extraction,
      snapshot: { subjectId: "dialogue-case", profile: undefined, conversation: undefined },
    })
    const governance = args.contextGovernanceService.evaluate({
      extraction,
      snapshot: { subjectId: "dialogue-case", profile: undefined, conversation: undefined },
    })
    const route = args.shoppingRouter.route({ extraction, referenceResolution, governance })
    const actualSelectionMode = inferSelectionMode(testCase.message, testCase.context_summary)
    const actualShouldClarify = route.kind === "clarify" || route.kind === "unknown"
    const actualFamily = inferFamily(extraction)
    const failures = computeFailures({
      testCase,
      extraction,
      route,
      actualSelectionMode,
      actualShouldClarify,
      actualFamily,
    })
    entries.push({
      case_id: testCase.case_id || `dialogue-${entries.length + 1}`,
      source: "dialogue_seed",
      name: testCase.name,
      message: testCase.message,
      context_summary: testCase.context_summary,
      expected_intent: testCase.expected_intent,
      expected_route_kind: testCase.expected_route_kind,
      expected_route_action: testCase.expected_route_action,
      expected_selection_mode: testCase.expected_selection_mode,
      expected_should_clarify: testCase.expected_should_clarify,
      expected_family: testCase.expected_family,
      expected_categories: testCase.expected_categories,
      catastrophic_mismatch: testCase.catastrophic_mismatch,
      suggested_failure_bucket: classifyFailureBucketFromExpectations(testCase),
      actual_intent: extraction.primary_intent,
      actual_route_kind: route.kind,
      actual_route_action: "action" in route ? route.action : undefined,
      actual_selection_mode: actualSelectionMode,
      actual_should_clarify: actualShouldClarify,
      actual_family: actualFamily,
      actual_categories: extraction.categories,
      failure_bucket: classifyFailureBucket({
        failures,
        actualShouldClarify,
        actualFamily,
        expectedFamily: testCase.expected_family,
      }),
      failures,
      review_status: "pending",
      notes: testCase.notes,
    })
  }
  return entries
}

export async function buildTrainingReviewFromTraffic(args: {
  analytics: UnderstandingAnalyticsService
  store: FileStateStore
  limit: number
}): Promise<TrainingReviewEntry[]> {
  const events = await args.store.listUnderstandingEvents({ limit: args.limit, feedbackOnly: true })
  const suggestedCases = await args.analytics.exportRecentCases({ limit: args.limit, feedbackOnly: true })
  const eventByCaseId = new Map<string, StoredUnderstandingEvent>()
  for (const event of events) {
    eventByCaseId.set(`event-${event.event_id}`, event)
  }
  return suggestedCases.map((testCase) => {
    const event = eventByCaseId.get(testCase.case_id || "")
    return {
      case_id: testCase.case_id || "",
      source: "traffic_failure",
      name: testCase.name,
      message: testCase.message,
      context_summary: testCase.context_summary,
      expected_intent: testCase.expected_intent,
      expected_route_kind: testCase.expected_route_kind,
      expected_route_action: testCase.expected_route_action,
      expected_selection_mode: testCase.expected_selection_mode,
      expected_should_clarify: testCase.expected_should_clarify,
      expected_family: testCase.expected_family,
      expected_categories: testCase.expected_categories,
      catastrophic_mismatch: testCase.catastrophic_mismatch,
      suggested_failure_bucket: testCase.suggested_failure_bucket,
      actual_intent: typeof event?.extraction_json?.primary_intent === "string" ? String(event?.extraction_json?.primary_intent) : undefined,
      actual_route_kind: event?.route_kind,
      actual_route_action: event?.route_action,
      actual_selection_mode: (event?.active_edit_mode as TrainingReviewEntry["actual_selection_mode"]) || undefined,
      actual_should_clarify: event?.route_kind === "clarify" || event?.route_kind === "unknown",
      actual_family: inferFamilyFromExtractionJson(event?.extraction_json),
      actual_categories: Array.isArray(event?.extraction_json?.categories)
        ? event?.extraction_json?.categories.map((value) => String(value || ""))
        : [],
      failure_bucket: testCase.suggested_failure_bucket,
      failures: [],
      review_status: "pending",
      notes: testCase.notes,
    }
  })
}

export async function buildImprovementProposals(
  reviewFile: string,
): Promise<TrainingImprovementProposal[]> {
  const raw = await readFile(resolve(reviewFile), "utf8")
  const entries = JSON.parse(raw) as TrainingReviewEntry[]
  const failedEntries = entries.filter((entry) => entry.failure_bucket || (entry.failures || []).length > 0)
  const groups = new Map<string, TrainingReviewEntry[]>()

  for (const entry of failedEntries) {
    const bucket = entry.failure_bucket || "other"
    const family = normalizeValue(entry.expected_family || entry.actual_family || "")
    const key = `${bucket}::${family || "general"}`
    const group = groups.get(key)
    if (group) {
      group.push(entry)
    } else {
      groups.set(key, [entry])
    }
  }

  const proposals = Array.from(groups.entries())
    .map(([key, group]) => buildProposalFromGroup(key, group))
    .sort((left, right) => right.affected_case_ids.length - left.affected_case_ids.length)

  return proposals
}

export async function applyAcceptedProposals(args: {
  proposalFile: string
  acceptedFile: string
}): Promise<AcceptedTrainingConfig> {
  const proposals = JSON.parse(await readFile(resolve(args.proposalFile), "utf8")) as Array<
    TrainingImprovementProposal & { review_status?: string }
  >
  const existing = loadAcceptedTrainingConfig(args.acceptedFile)
  const acceptedOnly = proposals.filter((proposal) => normalizeValue(String(proposal.review_status || "pending")) === "accepted")

  const aliasesByFamily = new Map<string, Set<string>>()
  for (const [family, aliases] of Object.entries(existing.accepted_aliases_by_family)) {
    aliasesByFamily.set(family, new Set(aliases))
  }
  const acceptedSeedDialogues = [...existing.accepted_seed_dialogues]
  const seenSeedIds = new Set(acceptedSeedDialogues.map((dialogue) => dialogue.dialogue_id))
  const promptExamples = new Set(existing.accepted_prompt_examples)

  for (const proposal of acceptedOnly) {
    const family = normalizeValue(proposal.family || "")
    if (family) {
      const familyAliases = aliasesByFamily.get(family) || new Set<string>()
      for (const alias of proposal.suggested_aliases || []) {
        if (!String(alias || "").trim()) continue
        familyAliases.add(String(alias).trim())
      }
      aliasesByFamily.set(family, familyAliases)
    }
    for (const example of proposal.suggested_prompt_examples || []) {
      if (String(example || "").trim()) promptExamples.add(String(example).trim())
    }
    for (const seedMessage of proposal.example_messages || []) {
      const dialogue = buildAcceptedSeedDialogue(proposal, seedMessage)
      if (!dialogue || seenSeedIds.has(dialogue.dialogue_id)) continue
      acceptedSeedDialogues.push(dialogue)
      seenSeedIds.add(dialogue.dialogue_id)
    }
  }

  return {
    accepted_aliases_by_family: Object.fromEntries(
      Array.from(aliasesByFamily.entries()).map(([family, aliases]) => [family, Array.from(aliases).sort()]),
    ),
    accepted_seed_dialogues: acceptedSeedDialogues,
    accepted_prompt_examples: Array.from(promptExamples).sort(),
  }
}

async function readDialogueSeeds(filePath: string): Promise<DialogueSeed[]> {
  const raw = await readFile(resolve(filePath), "utf8")
  const staticDialogues = JSON.parse(raw) as DialogueSeed[]
  if (!isDefaultDialogueSeedFile(filePath)) {
    return staticDialogues
  }
  return [...staticDialogues, ...buildGeneratedDialogueSeeds()]
}

function summarizeHistory(history: string[]): string | undefined {
  if (!history.length) return undefined
  return history.slice(-8).join(" || ")
}

function isDefaultDialogueSeedFile(filePath: string): boolean {
  return basename(resolve(filePath)) === "dialogue-training.seed.json"
}

export function buildGeneratedDialogueSeeds(): DialogueSeed[] {
  const families: DialogueFamilyConfig[] = mergeAcceptedAliasesIntoFamilies(loadAcceptedTrainingConfig())
  const dialogues = buildGeneratedDialogueSeedsFromFamilies(families)
  const accepted = loadAcceptedTrainingConfig()
  return [...dialogues, ...accepted.accepted_seed_dialogues]
}

function buildGeneratedDialogueSeedsFromFamilies(families: DialogueFamilyConfig[]): DialogueSeed[] {
  const dialogues: DialogueSeed[] = []
  for (const familyConfig of families) {
    for (const alias of familyConfig.aliases) {
      dialogues.push(
        makeSeed({
          id: `${familyConfig.family}-${slugify(alias)}-browse-basic`,
          name: `${alias} browse basic`,
          turns: [userTurn(`Ich brauche ${alias}`, familyConfig.family)],
        }),
        makeSeed({
          id: `${familyConfig.family}-${slugify(alias)}-browse-buy`,
          name: `${alias} browse buy`,
          turns: [userTurn(`Ich moechte ${alias} kaufen`, familyConfig.family)],
        }),
        makeSeed({
          id: `${familyConfig.family}-${slugify(alias)}-browse-question`,
          name: `${alias} browse question`,
          turns: [userTurn(`Welche ${alias} gibt es?`, familyConfig.family)],
        }),
        makeSeed({
          id: `${familyConfig.family}-${slugify(alias)}-browse-show`,
          name: `${alias} show options`,
          turns: [userTurn(`Zeig mir ${alias}`, familyConfig.family)],
        }),
        makeSeed({
          id: `${familyConfig.family}-${slugify(alias)}-browse-short`,
          name: `${alias} short request`,
          turns: [{ role: "assistant", message: "Was brauchst du?" }, userTurn(alias, familyConfig.family)],
        }),
        makeSeed({
          id: `${familyConfig.family}-${slugify(alias)}-add-auch`,
          name: `${alias} additive with auch`,
          turns: [
            { role: "assistant", message: "Aktueller Warenkorb: 2x Hafermilch" },
            userTurn(`Ich brauche auch ${alias}`, familyConfig.family, "add_to_existing_cart"),
          ],
        }),
        makeSeed({
          id: `${familyConfig.family}-${slugify(alias)}-add-noch`,
          name: `${alias} additive with noch`,
          turns: [
            { role: "assistant", message: "Aktueller Warenkorb: 2x Hafermilch" },
            userTurn(`Und noch ${alias}`, familyConfig.family, "add_to_existing_cart"),
          ],
        }),
        makeSeed({
          id: `${familyConfig.family}-${slugify(alias)}-replace-nur`,
          name: `${alias} replace with nur`,
          turns: [
            { role: "assistant", message: "Aktueller Warenkorb: 2x Hafermilch" },
            userTurn(`Nur ${alias}`, familyConfig.family, "replace_with_single_product"),
          ],
        }),
        makeSeed({
          id: `${familyConfig.family}-${slugify(alias)}-replace-statt`,
          name: `${alias} replace with statt`,
          turns: [
            { role: "assistant", message: "Aktueller Warenkorb: 2x Hafermilch" },
            userTurn(`Statt dem aktuellen Produkt moechte ich ${alias}`, familyConfig.family, "replace_with_single_product"),
          ],
        }),
        makeSeed({
          id: `${familyConfig.family}-${slugify(alias)}-stale-switch`,
          name: `${alias} overrides stale quantity context`,
          turns: [
            { role: "assistant", message: "Wie viele Flaschen Bier moechtest du?" },
            userTurn(`Ich brauche ${alias}`, familyConfig.family, undefined, true),
          ],
        }),
        makeSeed({
          id: `${familyConfig.family}-${slugify(alias)}-correction`,
          name: `${alias} correction turn`,
          turns: [
            { role: "assistant", message: "Meinst du die letzte Liste oder etwas Neues?" },
            userTurn(`Nein, ich meine ${alias}`, familyConfig.family, undefined, true),
          ],
        }),
      )
    }
  }

  dialogues.push(
    makeSeed({
      id: "occasion-movie-night-snacks-generated",
      name: "Occasion snacks movie night",
      turns: [userTurn("Snacks fuer einen Fernsehabend", "snacks")],
    }),
    makeSeed({
      id: "occasion-party-drinks-generated",
      name: "Occasion drinks party",
      turns: [userTurn("Getraenke fuer eine Party mit 8 Leuten", "getraenke")],
    }),
    makeSeed({
      id: "recipe-paella-generated",
      name: "Recipe paella generated",
      turns: [recipeTurn("Paella", "paella")],
    }),
    makeSeed({
      id: "recipe-musaka-generated",
      name: "Recipe musaka generated",
      turns: [recipeTurn("Ich moechte Musaka kochen", "musaka")],
    }),
    makeSeed({
      id: "recipe-lasagne-generated",
      name: "Recipe lasagne generated",
      turns: [recipeTurn("Ich will Lasagne machen", "lasagne")],
    }),
  )

  return dialogues
}

const BASE_DIALOGUE_FAMILIES: DialogueFamilyConfig[] = [
    { family: "kaese", aliases: ["Kaese", "Frischkaese", "Hartkaese", "Mozzarella", "Gouda"] },
    { family: "fleisch", aliases: ["Fleisch", "Rindfleisch", "Huhn", "Gefluegel", "Schwein"] },
    { family: "getraenke", aliases: ["Getraenke", "Bier", "Wein", "Saft", "Limo"] },
    { family: "putzmittel", aliases: ["Putzmittel", "Reinigungsmittel", "Badreiniger", "Kuechenreiniger", "WC Reiniger"] },
    { family: "brot", aliases: ["Brot", "Toast", "Weckerl", "Semmeln", "Baguette"] },
    { family: "milchprodukte", aliases: ["Milchprodukte", "Milch", "Joghurt", "Sahne", "Buttermilch"] },
    { family: "brotaufstriche", aliases: ["Brotaufstriche", "Marmelade", "Honig", "Erdnussbutter", "Nusscreme"] },
    { family: "konserven", aliases: ["Konserven", "Dosentomaten", "Bohnen aus der Dose", "Mais aus der Dose", "Thunfischdose"] },
    { family: "fruhstuck", aliases: ["Fruehstueck", "Fruehstueckszeug", "Morgenessen", "Fruehstuecksprodukte", "Sachen fuers Fruehstueck"] },
    { family: "gemuese", aliases: ["Gemuese", "Tomaten", "Paprika", "Gurken", "Salat"] },
    { family: "wurst", aliases: ["Wurst", "Salami", "Extrawurst", "Bratwurst", "Leberkaese"] },
    { family: "schinken", aliases: ["Schinken", "Kochschinken", "Prosciutto", "Rohschinken", "Putenschinken"] },
    { family: "speck", aliases: ["Speck", "Bacon", "Fruehstuecksspeck", "Bauchspeck", "Wuermelspeck"] },
    { family: "pasta", aliases: ["Pasta", "Spaghetti", "Penne", "Tagliatelle", "Nudeln"] },
    { family: "reis", aliases: ["Reis", "Basmatireis", "Jasminreis", "Sushireis", "Langkornreis"] },
    { family: "feinkost", aliases: ["Feinkost", "Oliven", "Tapenade", "Delikatessen", "Gourmet"] },
    { family: "antipasti", aliases: ["Antipasti", "Olivenmix", "Eingelegtes Gemuese", "Artischocken", "Peperoni"] },
    { family: "backen", aliases: ["Backen", "Mehl", "Zucker", "Backpulver", "Vanillezucker"] },
    { family: "koerperpflege", aliases: ["Koerperpflege", "Duschgel", "Shampoo", "Seife", "Deo"] },
    { family: "muesli", aliases: ["Muesli", "Haferflocken", "Crunchy", "Granola", "Porridge"] },
    { family: "haustier", aliases: ["Haustier", "Hundefutter", "Katzenfutter", "Leckerli", "Katzenstreu"] },
    { family: "baby", aliases: ["Baby Nahrung", "Babybrei", "Babymilch", "Babyglaser", "Baby Snacks"] },
    { family: "household_paper", aliases: ["Klopapier", "Toilettenpapier", "Kuechenrolle", "Taschenuecher", "Haushaltspapier"] },
    { family: "snacks", aliases: ["Snacks", "Chips", "Nuesse", "Cracker", "Popcorn"] },
]

function userTurn(
  message: string,
  family: string,
  selectionMode?: "replace_with_single_product" | "add_to_existing_cart",
  catastrophicMismatch?: boolean,
): DialogueTurn {
  return {
    role: "user",
    message,
    expected_intent: "browse_category",
    expected_route_kind: "browse_category",
    expected_selection_mode: selectionMode,
    expected_family: family,
    expected_should_clarify: false,
    catastrophic_mismatch: catastrophicMismatch,
  }
}

function recipeTurn(message: string, family: string): DialogueTurn {
  return {
    role: "user",
    message,
    expected_intent: "recipe_to_cart",
    expected_route_kind: "recipe_to_cart",
    expected_family: family,
    expected_should_clarify: false,
    catastrophic_mismatch: true,
  }
}

function makeSeed(args: { id: string; name: string; turns: DialogueTurn[] }): DialogueSeed {
  return {
    dialogue_id: `gen-${args.id}`,
    name: args.name,
    turns: args.turns,
  }
}

function slugify(value: string): string {
  return normalizeValue(value).replace(/\s+/g, "-")
}

function computeFailures(args: {
  testCase: UnderstandingEvalCaseFile
  extraction: Awaited<ReturnType<IntentExtractionService["extract"]>>
  route: ReturnType<ShoppingRouter["route"]>
  actualSelectionMode?: "replace_with_single_product" | "add_to_existing_cart"
  actualShouldClarify: boolean
  actualFamily?: string
}): string[] {
  const failures: string[] = []
  if (args.testCase.expected_intent && args.extraction.primary_intent !== args.testCase.expected_intent) {
    failures.push(`intent expected=${args.testCase.expected_intent} actual=${args.extraction.primary_intent}`)
  }
  if (args.testCase.expected_route_kind && args.route.kind !== args.testCase.expected_route_kind) {
    failures.push(`route expected=${args.testCase.expected_route_kind} actual=${args.route.kind}`)
  }
  const routeAction = "action" in args.route ? args.route.action : undefined
  if (args.testCase.expected_route_action && routeAction !== args.testCase.expected_route_action) {
    failures.push(`route_action expected=${args.testCase.expected_route_action} actual=${routeAction || "none"}`)
  }
  if (args.testCase.expected_selection_mode && args.actualSelectionMode !== args.testCase.expected_selection_mode) {
    failures.push(`selection_mode expected=${args.testCase.expected_selection_mode} actual=${args.actualSelectionMode || "none"}`)
  }
  if (typeof args.testCase.expected_should_clarify === "boolean" && args.actualShouldClarify !== args.testCase.expected_should_clarify) {
    failures.push(`should_clarify expected=${args.testCase.expected_should_clarify} actual=${args.actualShouldClarify}`)
  }
  if (args.testCase.expected_family && normalizeValue(args.testCase.expected_family) !== args.actualFamily) {
    failures.push(`family expected=${normalizeValue(args.testCase.expected_family)} actual=${args.actualFamily || "none"}`)
  }
  return failures
}

function classifyFailureBucket(args: {
  failures: string[]
  actualShouldClarify: boolean
  actualFamily?: string
  expectedFamily?: string
}): string {
  const joined = args.failures.join(" ; ")
  if (joined.includes("selection_mode")) return "wrong_selection_mode"
  if (joined.includes("should_clarify")) return "should_have_clarified"
  if (joined.includes("intent") && joined.includes("recipe")) return "recipe_misrouted"
  if (joined.includes("family")) return "overconfident_sku_commitment"
  if (!args.actualFamily && !args.actualShouldClarify && args.expectedFamily) return "stale_context_hijack"
  return "other"
}

function classifyFailureBucketFromExpectations(testCase: UnderstandingEvalCaseFile): string | undefined {
  if (testCase.expected_selection_mode === "add_to_existing_cart" || testCase.expected_selection_mode === "replace_with_single_product") {
    return "wrong_selection_mode"
  }
  if (testCase.expected_should_clarify) return "should_have_clarified"
  if (testCase.expected_intent === "recipe_to_cart" || testCase.expected_intent === "recipe_idea") {
    return "recipe_misrouted"
  }
  if (testCase.expected_family) return "overconfident_sku_commitment"
  return undefined
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
  if (normalizedContext.includes("aktueller warenkorb") || normalizedContext.includes("history=")) {
    if (/\b(kase|kaese|fleisch|getranke|getraenke|putzmittel|baby|brot|milch|reis|pasta)\b/.test(normalizedMessage)) {
      return "add_to_existing_cart"
    }
  }
  return undefined
}

function inferFamily(extraction: Awaited<ReturnType<IntentExtractionService["extract"]>>): string | undefined {
  const category = extraction.categories[0]
  if (category) return normalizeValue(category)
  const productName = extraction.product_queries[0]?.name
  return productName ? normalizeValue(productName) : undefined
}

function inferFamilyFromExtractionJson(extraction: Record<string, unknown> | undefined): string | undefined {
  if (!extraction) return undefined
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

function normalizeValue(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function parseOptionalInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback
}

function buildProposalFromGroup(
  key: string,
  group: TrainingReviewEntry[],
): TrainingImprovementProposal {
  const [failureBucket, familyKey] = key.split("::")
  const family = familyKey && familyKey !== "general" ? familyKey : undefined
  const exampleMessages = uniqueStrings(group.map((entry) => entry.message)).slice(0, 8)
  const affectedCaseIds = uniqueStrings(group.map((entry) => entry.case_id))
  const aliases = proposeAliases(group, family)
  const guardPhrases = proposeGuardPhrases(failureBucket, family)
  const promptExamples = proposePromptExamples(failureBucket, family, exampleMessages)
  const seedCases = proposeSeedCases(failureBucket, family, exampleMessages)
  const notes = proposeNotes(failureBucket, family, group.length)

  return {
    proposal_id: `proposal-${failureBucket}-${family || "general"}`,
    failure_bucket: failureBucket,
    family,
    example_messages: exampleMessages,
    affected_case_ids: affectedCaseIds,
    suggested_aliases: aliases,
    suggested_guard_phrases: guardPhrases,
    suggested_prompt_examples: promptExamples,
    suggested_seed_cases: seedCases,
    notes,
    review_status: "pending",
  }
}

function loadAcceptedTrainingConfig(filePath?: string): AcceptedTrainingConfig {
  const targetFile = resolve(
    filePath || process.env.WHATSAPP_TRAINING_ACCEPTED_FILE?.trim() || resolve(process.cwd(), "training-accepted-proposals.json"),
  )
  try {
    const raw = readFileSync(targetFile, "utf8")
    const parsed = JSON.parse(raw) as Partial<AcceptedTrainingConfig>
    return {
      accepted_aliases_by_family: isRecordOfArrays(parsed.accepted_aliases_by_family)
        ? parsed.accepted_aliases_by_family
        : {},
      accepted_seed_dialogues: Array.isArray(parsed.accepted_seed_dialogues)
        ? parsed.accepted_seed_dialogues as DialogueSeed[]
        : [],
      accepted_prompt_examples: Array.isArray(parsed.accepted_prompt_examples)
        ? parsed.accepted_prompt_examples.map((value) => String(value || ""))
        : [],
    }
  } catch {
    return {
      accepted_aliases_by_family: {},
      accepted_seed_dialogues: [],
      accepted_prompt_examples: [],
    }
  }
}

function mergeAcceptedAliasesIntoFamilies(accepted: AcceptedTrainingConfig): DialogueFamilyConfig[] {
  return BASE_DIALOGUE_FAMILIES.map((familyConfig) => {
    const acceptedAliases = accepted.accepted_aliases_by_family[familyConfig.family] || []
    return {
      family: familyConfig.family,
      aliases: uniqueStrings([...familyConfig.aliases, ...acceptedAliases]),
    }
  })
}

function buildAcceptedSeedDialogue(
  proposal: TrainingImprovementProposal & { review_status?: string },
  message: string,
): DialogueSeed | null {
  const normalizedMessage = String(message || "").trim()
  if (!normalizedMessage) return null
  const family = normalizeValue(proposal.family || "")
  const bucket = normalizeValue(proposal.failure_bucket || "other")
  const dialogueId = `accepted-${bucket}-${family || "general"}-${slugify(normalizedMessage)}`
  const isRecipe = bucket === "recipe_misrouted"
  return {
    dialogue_id: dialogueId,
    name: `Accepted proposal seed: ${normalizedMessage}`,
    turns: [
      isRecipe
        ? recipeTurn(normalizedMessage, family || "recipe")
        : userTurn(normalizedMessage, family || "general"),
    ],
  }
}

function proposeAliases(group: TrainingReviewEntry[], family?: string): string[] {
  const tokens = new Set<string>()
  for (const entry of group) {
    const normalized = normalizeValue(entry.message)
    for (const token of normalized.split(" ")) {
      if (token.length < 4) continue
      if (family && token === family) continue
      if (["ich", "auch", "noch", "mehr", "bitte", "brauche", "mochte", "will", "meine"].includes(token)) continue
      tokens.add(token)
    }
  }
  if (family) tokens.add(family)
  return Array.from(tokens).slice(0, 10)
}

function proposeGuardPhrases(failureBucket: string, family?: string): string[] {
  if (failureBucket === "wrong_selection_mode") {
    return ["auch X -> append", "noch X -> append", "nur X -> replace", "statt X -> replace"]
  }
  if (failureBucket === "stale_context_hijack") {
    return ["recipe or dish mention discards stale product context", "correction overrides continuation"]
  }
  if (failureBucket === "invalid_numeric_grounding") {
    return ["numeric replies only valid with pending question or shown options"]
  }
  if (failureBucket === "should_have_clarified") {
    return [`broad ${family || "family"} terms should browse or clarify before sku commitment`]
  }
  if (failureBucket === "overconfident_sku_commitment") {
    return [`prefer category-first routing for ${family || "broad family"} requests`]
  }
  if (failureBucket === "recipe_misrouted") {
    return ["explicit dish mentions should route to recipe flow before catalog search"]
  }
  return ["prefer clarification over unsafe mutation when confidence is weak"]
}

function proposePromptExamples(
  failureBucket: string,
  family: string | undefined,
  exampleMessages: string[],
): string[] {
  const examples = exampleMessages.slice(0, 4)
  return examples.map((message) => {
    if (failureBucket === "wrong_selection_mode") {
      return `Message: "${message}" -> selection_mode should be append or replace explicitly, not inferred from SKU matching`
    }
    if (failureBucket === "recipe_misrouted") {
      return `Message: "${message}" -> explicit dish/cooking intent should override stale shopping context`
    }
    if (failureBucket === "overconfident_sku_commitment") {
      return `Message: "${message}" -> broad ${family || "shopping family"} request should prefer browse/clarify over exact SKU`
    }
    return `Message: "${message}" -> prefer conservative grounding and clarify if unsafe to act`
  })
}

function proposeSeedCases(
  failureBucket: string,
  family: string | undefined,
  exampleMessages: string[],
): string[] {
  return exampleMessages.slice(0, 3).map((message, index) => {
    const targetFamily = family || "general"
    return `seed:${failureBucket}:${targetFamily}:${index + 1}:${message}`
  })
}

function proposeNotes(
  failureBucket: string,
  family: string | undefined,
  count: number,
): string[] {
  return [
    `Clustered ${count} failing turns in bucket ${failureBucket}.`,
    family ? `Most cases center on family ${family}.` : "No dominant family detected.",
    "Use these proposals as reviewed inputs for aliases, deterministic guards, prompts, and new seed eval cases.",
  ]
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of values) {
    const normalized = String(value || "").trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    output.push(normalized)
  }
  return output
}

function isRecordOfArrays(value: unknown): value is Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return Object.values(value).every((entry) => Array.isArray(entry) && entry.every((item) => typeof item === "string"))
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(resolve(filePath), `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
