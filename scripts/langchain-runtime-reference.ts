import { createServer } from "node:http"

type SoulResponseSchema = {
  replyKey?: string
  followUpQuestionKey?: string
  nextStepKey?: string
  summaryKey?: string
  userProfileKey?: string
  rootPatternKey?: string
}

type RequestBody = {
  soul?: {
    id?: string
    name?: string
    locale?: string
    systemPrompt?: string
    responseSchema?: SoulResponseSchema
  }
  message?: string
  locale?: string
  protocolSubjectHeader?: string
  memory?: {
    summaries?: string[]
    recentTurns?: Array<{ role?: string; content?: string }>
    userProfile?: Record<string, unknown>
  }
}

const PORT = Number(process.env.PORT || "8800")
const HOST = process.env.HOST?.trim() || "0.0.0.0"
const API_TOKEN = process.env.LANGCHAIN_RUNTIME_TOKEN?.trim() || ""

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/runtime") {
    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: false, error: "not_found" }))
    return
  }

  if (API_TOKEN) {
    const auth = String(req.headers.authorization || "").trim()
    if (auth !== `Bearer ${API_TOKEN}`) {
      res.writeHead(401, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }))
      return
    }
  }

  try {
    const raw = await readRequestBody(req)
    const body = JSON.parse(raw || "{}") as RequestBody
    const response = await generateStructuredResponse(body)

    console.log(JSON.stringify({
      level: "info",
      event: "langchain_runtime_reference_request",
      soulId: body.soul?.id || null,
      protocolSubjectHeader: body.protocolSubjectHeader || null,
      messagePreview: String(body.message || "").slice(0, 120),
    }))

    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify(response))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({
      level: "error",
      event: "langchain_runtime_reference_error",
      message,
    }))
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: false, error: "internal_error", message: "LangChain reference runtime failed." }))
  }
})

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({
    level: "info",
    event: "langchain_runtime_reference_started",
    host: HOST,
    port: PORT,
    path: "/runtime",
    authRequired: Boolean(API_TOKEN),
  }))
})

async function generateStructuredResponse(body: RequestBody): Promise<Record<string, unknown>> {
  const schema = body.soul?.responseSchema || {}
  const locale = String(body.locale || body.soul?.locale || "de")
  const message = String(body.message || "").trim()
  const soulName = String(body.soul?.name || body.soul?.id || "Assistant")
  const summary = Array.isArray(body.memory?.summaries) ? body.memory?.summaries.at(-1) : undefined

  const prompt = buildLangChainInput({
    systemPrompt: String(body.soul?.systemPrompt || ""),
    message,
    summary,
    locale,
  })

  // Replace this with a real LangChain chain invocation.
  const chainResult = await runReferenceChain(prompt, { locale, soulName, message })

  const replyKey = String(schema.replyKey || "reply")
  const response: Record<string, unknown> = {
    [replyKey]: chainResult.reply,
  }

  if (schema.followUpQuestionKey) response[String(schema.followUpQuestionKey)] = chainResult.followUpQuestion
  if (schema.nextStepKey) response[String(schema.nextStepKey)] = chainResult.nextStep
  if (schema.summaryKey) response[String(schema.summaryKey)] = chainResult.summary
  if (schema.userProfileKey) response[String(schema.userProfileKey)] = chainResult.userProfile
  if (schema.rootPatternKey) response[String(schema.rootPatternKey)] = chainResult.rootPattern

  return response
}

function buildLangChainInput(args: {
  systemPrompt: string
  message: string
  summary?: string
  locale: string
}): string {
  return [
    args.systemPrompt || "No system prompt configured.",
    args.summary ? `Existing summary: ${args.summary}` : "Existing summary: none",
    `Locale: ${args.locale}`,
    `User message: ${args.message}`,
  ].join("\n\n")
}

async function runReferenceChain(
  prompt: string,
  args: {
    locale: string
    soulName: string
    message: string
  },
): Promise<{
  reply: string
  followUpQuestion: string
  nextStep: string
  summary: string
  userProfile: Record<string, unknown>
  rootPattern: string
}> {
  const rootPattern = detectRootPattern(args.message.toLowerCase())
  const explanation = args.locale.startsWith("de")
    ? `${args.soulName}: Ich habe deinen Kontext aufgenommen und darauf eine strukturierte Antwort vorbereitet.`
    : `${args.soulName}: I used your context to prepare a structured response.`

  return {
    reply: [explanation, promptToReplyFocus(rootPattern, args.locale)].join(" "),
    followUpQuestion: buildQuestion(rootPattern, args.locale),
    nextStep: buildNextStep(rootPattern, args.locale),
    summary: prompt.slice(0, 180),
    userProfile: {
      preferred_language: args.locale,
      current_focus: rootPattern,
    },
    rootPattern,
  }
}

function detectRootPattern(message: string): string {
  if (/(stress|druck|ueberfordert|überfordert|erschoepft|erschöpft)/.test(message)) return "stress"
  if (/(entscheidung|option|choose|decide|wahl)/.test(message)) return "decision"
  if (/(support|problem|issue|fehler|kunde|ticket)/.test(message)) return "support"
  return "clarity"
}

function promptToReplyFocus(pattern: string, locale: string): string {
  const de: Record<string, string> = {
    stress: "Ich sehe vor allem Druck und Ueberlastung.",
    decision: "Ich sehe vor allem eine noch unscharfe Entscheidung.",
    support: "Ich sehe vor allem ein klares Support-Hindernis.",
    clarity: "Ich sehe vor allem ein Thema, das noch geschaerft werden sollte.",
  }
  const en: Record<string, string> = {
    stress: "I mostly see pressure and overload here.",
    decision: "I mostly see a decision that still needs shape.",
    support: "I mostly see a concrete support blocker here.",
    clarity: "I mostly see a topic that still needs sharpening.",
  }
  return locale.startsWith("de") ? de[pattern] : en[pattern]
}

function buildQuestion(pattern: string, locale: string): string {
  const de: Record<string, string> = {
    stress: "Welcher Teil davon fuehlt sich heute am schwersten an?",
    decision: "Welche zwei Optionen sind gerade wirklich relevant?",
    support: "Was genau bricht oder blockiert aktuell?",
    clarity: "Wie wuerdest du das Thema in einem Satz zuspitzen?",
  }
  const en: Record<string, string> = {
    stress: "Which part of this feels heaviest today?",
    decision: "What are the two options that actually matter here?",
    support: "What exactly is breaking or blocking right now?",
    clarity: "How would you sharpen this into one sentence?",
  }
  return locale.startsWith("de") ? de[pattern] : en[pattern]
}

function buildNextStep(pattern: string, locale: string): string {
  const de: Record<string, string> = {
    stress: "Beschreibe zuerst nur den Teil, den du heute beeinflussen kannst.",
    decision: "Schreibe zuerst das wichtigste Abwaegungskriterium auf.",
    support: "Beschreibe zuerst den letzten funktionierenden Zustand.",
    clarity: "Formuliere zuerst das gewuenschte Ergebnis dieses Gespraechs.",
  }
  const en: Record<string, string> = {
    stress: "Start by naming the part you can influence today.",
    decision: "Start by writing down the main decision criterion.",
    support: "Start by describing the last known working state.",
    clarity: "Start by stating the desired outcome of this conversation.",
  }
  return locale.startsWith("de") ? de[pattern] : en[pattern]
}

async function readRequestBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf8")
}
