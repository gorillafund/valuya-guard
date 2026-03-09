export type OrderProduct = {
  sku: string
  name: string
  qty: number
  unit_price_cents?: number
}

export type OrderPayload = {
  order_id: string
  source: "telegram"
  customer_number: "89733"
  resource: string
  plan: string
  usage_idempotency_key?: string
  delivery: { type: "sofort" }
  delivery_address: {
    street: "Kaiserstrasse 8/7a"
    postal_code: "1070"
    city: "Wien"
    country: "AT"
  }
  products: OrderProduct[]
  meta: {
    recipe_title?: string
    total_cents?: number
    actor_type?: string
    channel?: string
    subject_type?: string
    subject_external_id?: string
  }
}

type BuildOrderPayloadArgs = {
  orderId: string
  resource: string
  plan: string
  cartItems?: unknown
  recipeTitle?: string
  totalCents?: unknown
}

type SendOrderArgs = {
  baseUrl: string
  token: string
  subjectId: string
  orderPayload: OrderPayload
  usageIdempotencyKey?: string
  log?: (event: string, fields: Record<string, unknown>) => void
  fetchImpl?: typeof fetch
  maxRetries?: number
  initialBackoffMs?: number
}

export type EntitlementDecision = {
  active: boolean
  reason?: string
}

export async function waitForActiveEntitlementState(args: {
  checkEntitlement: () => Promise<EntitlementDecision>
  maxAttempts: number
  delaysMs: number[]
  sleepFn?: (ms: number) => Promise<void>
}): Promise<{ active: boolean; attempts: number; reason?: string }> {
  const sleepFn = args.sleepFn ?? sleep
  let lastReason = "inactive"

  for (let attempt = 1; attempt <= args.maxAttempts; attempt++) {
    const ent = await args.checkEntitlement()
    lastReason = ent.reason || lastReason
    if (ent.active) return { active: true, attempts: attempt, reason: ent.reason }

    const delay = args.delaysMs[Math.min(attempt - 1, args.delaysMs.length - 1)] ?? 0
    if (attempt < args.maxAttempts && delay > 0) {
      await sleepFn(delay)
    }
  }

  return { active: false, attempts: args.maxAttempts, reason: lastReason }
}

export async function submitOrderWithEntitlementGuard(args: {
  checkEntitlement: () => Promise<EntitlementDecision>
  sendOrder: () => Promise<unknown>
  onPaymentRequired?: () => Promise<void> | void
}): Promise<{ submitted: boolean; reason?: string; response?: unknown }> {
  const ent = await args.checkEntitlement()
  if (!ent.active) {
    await args.onPaymentRequired?.()
    return { submitted: false, reason: ent.reason || "payment_required" }
  }
  const response = await args.sendOrder()
  return { submitted: true, response }
}

export function buildOrderPayload(args: BuildOrderPayloadArgs): OrderPayload {
  assertNonEmpty(args.resource, "resource_required")
  assertNonEmpty(args.plan, "plan_required")
  assertPlanAllowed(args.plan)

  const products = mapProducts(args.cartItems)
  const totalCents = normalizeNumber(args.totalCents)

  const meta: { recipe_title?: string; total_cents?: number } = {}
  if (args.recipeTitle && args.recipeTitle.trim()) {
    meta.recipe_title = args.recipeTitle.trim()
  }
  if (typeof totalCents === "number") {
    meta.total_cents = totalCents
  }

  return {
    order_id: String(args.orderId),
    source: "telegram",
    customer_number: "89733",
    resource: String(args.resource),
    plan: String(args.plan),
    delivery: { type: "sofort" },
    delivery_address: {
      street: "Kaiserstrasse 8/7a",
      postal_code: "1070",
      city: "Wien",
      country: "AT",
    },
    products,
    meta,
  }
}

export async function sendOrderToBackendRequest(args: SendOrderArgs): Promise<unknown> {
  const subjectId = validateSubjectId(args.subjectId)
  assertNonEmpty(args.orderPayload.resource, "resource_required")
  assertNonEmpty(args.orderPayload.plan, "plan_required")
  assertPlanAllowed(args.orderPayload.plan)

  const fetchImpl = args.fetchImpl ?? fetch
  const maxRetries = args.maxRetries ?? 2
  const initialBackoffMs = args.initialBackoffMs ?? 300
  const endpoint = `${args.baseUrl.replace(/\/+$/, "")}/api/agent/orders`
  const payloadToSend: OrderPayload = args.usageIdempotencyKey
    ? {
        ...args.orderPayload,
        usage_idempotency_key: args.usageIdempotencyKey,
      }
    : args.orderPayload

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      args.log?.("order_request", {
        endpoint,
        orderId: payloadToSend.order_id,
        subjectId,
        resource: payloadToSend.resource,
        plan: payloadToSend.plan,
        usageProofKey: args.usageIdempotencyKey ?? null,
        attempt,
      })

      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${args.token}`,
          "X-Valuya-Subject": subjectId,
          "Idempotency-Key": `order-email:${payloadToSend.order_id}`,
          ...(args.usageIdempotencyKey
            ? { "X-Valuya-Usage-Idempotency-Key": args.usageIdempotencyKey }
            : {}),
        },
        body: JSON.stringify(payloadToSend),
      })

      const body = await safeParseJson(response)
      args.log?.("order_response", {
        endpoint,
        orderId: payloadToSend.order_id,
        subjectId,
        status: response.status,
        ...(response.ok ? {} : { errorBody: body }),
        attempt,
      })
      if (response.ok) return body

      if (shouldRetryStatus(response.status) && attempt <= maxRetries) {
        await sleep(initialBackoffMs * Math.pow(2, attempt - 1))
        continue
      }

      const err = new Error(
        `order_backend_http_${response.status}:${JSON.stringify(body).slice(0, 300)}`,
      )
      ;(err as any).details = {
        status: response.status,
        body,
        usageIdempotencyKey: args.usageIdempotencyKey ?? null,
      }
      throw err
    } catch (error) {
      if (isNonRetryableHttpError(error)) throw error
      if (attempt > maxRetries) throw error
      await sleep(initialBackoffMs * Math.pow(2, attempt - 1))
    }
  }

  throw new Error("order_backend_unreachable")
}

function mapProducts(input: unknown): OrderProduct[] {
  if (!Array.isArray(input)) return []
  const out: OrderProduct[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue
    const item = raw as Record<string, unknown>
    const sku = String(item.sku ?? "").trim()
    const name = String(item.name ?? "").trim()
    if (!sku || !name) continue

    const qty = normalizeNumber(item.qty) ?? 1
    const unitPrice = normalizeNumber(item.unit_price_cents)
    const product: OrderProduct = {
      sku,
      name,
      qty,
    }
    if (typeof unitPrice === "number") {
      product.unit_price_cents = unitPrice
    }
    out.push(product)
  }
  return out
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === "string" && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return Math.trunc(n)
  }
  return undefined
}

function shouldRetryStatus(status: number): boolean {
  return status >= 500
}

async function safeParseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isNonRetryableHttpError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /^order_backend_http_4\d\d:/.test(error.message)
}

export function validateSubjectId(subjectId: string): string {
  const value = String(subjectId || "").trim()
  if (!value) throw new Error("subject_required")
  const i = value.indexOf(":")
  if (i <= 0 || i === value.length - 1) throw new Error("subject_invalid")
  const type = value.slice(0, i).trim()
  const id = value.slice(i + 1).trim()
  if (!type || !id) throw new Error("subject_invalid")
  return `${type}:${id}`
}

function assertPlanAllowed(plan: string): void {
  if (String(plan).trim().toLowerCase() === "free") {
    throw new Error("plan_free_not_allowed")
  }
}

function assertNonEmpty(v: string, code: string): void {
  if (!String(v || "").trim()) {
    throw new Error(code)
  }
}
