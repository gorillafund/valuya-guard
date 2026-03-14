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
  version?: string
  provider?: string
  soul?: {
    id?: string
    name?: string
    locale?: string
    systemPrompt?: string
    responseSchema?: SoulResponseSchema
  }
  message?: string
  protocolSubjectHeader?: string
  locale?: string
  memory?: {
    summaries?: string[]
    recentTurns?: Array<{ role?: string; content?: string }>
    userProfile?: Record<string, unknown>
  }
}

const PORT = Number(process.env.PORT || "8799")
const HOST = process.env.HOST?.trim() || "0.0.0.0"
const API_TOKEN = process.env.SOUL_RUNTIME_DEMO_TOKEN?.trim() || ""

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
    const schema = body.soul?.responseSchema || {}
    const message = String(body.message || "").trim()
    const replyKey = String(schema.replyKey || "reply")
    const questionKey = schema.followUpQuestionKey ? String(schema.followUpQuestionKey) : ""
    const nextStepKey = schema.nextStepKey ? String(schema.nextStepKey) : ""
    const summaryKey = schema.summaryKey ? String(schema.summaryKey) : ""
    const userProfileKey = schema.userProfileKey ? String(schema.userProfileKey) : ""
    const rootPatternKey = schema.rootPatternKey ? String(schema.rootPatternKey) : ""

    const reply = buildReply({
      message,
      soulName: String(body.soul?.name || body.soul?.id || "Assistant"),
      locale: String(body.locale || body.soul?.locale || "de"),
      summaries: Array.isArray(body.memory?.summaries) ? body.memory?.summaries || [] : [],
    })

    const payload: Record<string, unknown> = {
      [replyKey]: reply.reply,
    }

    if (questionKey) payload[questionKey] = reply.followUpQuestion
    if (nextStepKey) payload[nextStepKey] = reply.nextStep
    if (summaryKey) payload[summaryKey] = reply.summary
    if (userProfileKey) payload[userProfileKey] = reply.userProfile
    if (rootPatternKey) payload[rootPatternKey] = reply.rootPattern

    console.log(JSON.stringify({
      level: "info",
      event: "external_soul_runtime_demo_request",
      version: body.version || null,
      provider: body.provider || null,
      protocolSubjectHeader: body.protocolSubjectHeader || null,
      soulId: body.soul?.id || null,
      soulName: body.soul?.name || null,
      locale: body.locale || body.soul?.locale || null,
      messagePreview: message.slice(0, 120),
    }))

    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify(payload))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({
      level: "error",
      event: "external_soul_runtime_demo_error",
      message,
    }))
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: false, error: "internal_error", message: "Demo runtime failed." }))
  }
})

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({
    level: "info",
    event: "external_soul_runtime_demo_started",
    host: HOST,
    port: PORT,
    path: "/runtime",
    authRequired: Boolean(API_TOKEN),
  }))
})

async function readRequestBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf8")
}

function buildReply(args: {
  message: string
  soulName: string
  locale: string
  summaries: string[]
}): {
  reply: string
  followUpQuestion: string
  nextStep: string
  summary: string
  userProfile: Record<string, unknown>
  rootPattern: string
} {
  const lower = args.message.toLowerCase()
  const rootPattern = detectRootPattern(lower)
  const previousSummary = args.summaries.at(-1)

  if (args.locale.startsWith("de")) {
    return {
      reply: [
        `${args.soulName}: Ich habe dein Anliegen aufgenommen.`,
        previousSummary ? `Ich habe noch im Blick: ${previousSummary}` : null,
        `Im Moment klingt es fuer mich vor allem nach ${describePattern(rootPattern)}.`,
      ].filter(Boolean).join(" "),
      followUpQuestion: buildQuestion(rootPattern, "de"),
      nextStep: buildNextStep(rootPattern, "de"),
      summary: `Thema: ${describePattern(rootPattern)}. Nachricht: ${args.message.slice(0, 140)}`,
      userProfile: {
        preferred_language: "de",
        current_focus: rootPattern,
      },
      rootPattern,
    }
  }

  return {
    reply: [
      `${args.soulName}: I picked up your message.`,
      previousSummary ? `I still have this in mind: ${previousSummary}` : null,
      `Right now this sounds mostly like ${describePattern(rootPattern)}.`,
    ].filter(Boolean).join(" "),
    followUpQuestion: buildQuestion(rootPattern, "en"),
    nextStep: buildNextStep(rootPattern, "en"),
    summary: `Theme: ${describePattern(rootPattern)}. Message: ${args.message.slice(0, 140)}`,
    userProfile: {
      preferred_language: "en",
      current_focus: rootPattern,
    },
    rootPattern,
  }
}

function detectRootPattern(message: string): string {
  if (/(stress|druck|ueberfordert|überfordert|erschöpft|erschoepft)/.test(message)) return "stress"
  if (/(entscheidung|decide|option|wahl|choose)/.test(message)) return "decision"
  if (/(kunde|support|bug|problem|fehler|issue)/.test(message)) return "support"
  return "clarity"
}

function describePattern(pattern: string): string {
  switch (pattern) {
    case "stress":
      return "pressure and overload"
    case "decision":
      return "a decision that still needs shape"
    case "support":
      return "a concrete support issue"
    default:
      return "something that needs more clarity"
  }
}

function buildQuestion(pattern: string, locale: "de" | "en"): string {
  const de: Record<string, string> = {
    stress: "Was fuehlt sich daran gerade am engsten oder schwersten an?",
    decision: "Zwischen welchen zwei Optionen stehst du gerade wirklich?",
    support: "Was genau blockiert dich im Moment am staerksten?",
    clarity: "Wenn du dein Thema in einem Satz zuspitzen muesstest, wie wuerde er lauten?",
  }
  const en: Record<string, string> = {
    stress: "What part of this feels the tightest or heaviest right now?",
    decision: "What are the two real options you are weighing?",
    support: "What exactly is blocking you the most right now?",
    clarity: "If you had to sharpen this into one sentence, what would it be?",
  }
  return locale === "de" ? de[pattern] : en[pattern]
}

function buildNextStep(pattern: string, locale: "de" | "en"): string {
  const de: Record<string, string> = {
    stress: "Nenne zuerst nur den einen Teil, den du heute beeinflussen kannst.",
    decision: "Schreibe die wichtigste Abwaegung in einem kurzen Satz auf.",
    support: "Beschreibe zuerst den letzten Schritt vor dem Fehler oder Hindernis.",
    clarity: "Formuliere zuerst, was du dir nach diesem Gespraech konkret erhoffst.",
  }
  const en: Record<string, string> = {
    stress: "Start by naming the one part you can influence today.",
    decision: "Write down the main tradeoff in one short sentence.",
    support: "Start with the last step right before the issue happened.",
    clarity: "Start by stating what concrete outcome you want from this conversation.",
  }
  return locale === "de" ? de[pattern] : en[pattern]
}
