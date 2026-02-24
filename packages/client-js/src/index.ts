export type PaymentRequiredBody = {
  error: "payment_required"
  payment_url: string
  session_id: string
  reason?: string
  resource?: string
  required?: unknown
  evaluated_plan?: string
  payment?: unknown
}

export type GuardFetchResult<T = unknown> =
  | { ok: true; status: number; data: T; response: Response }
  | { ok: false; status: 402; payment: PaymentRequiredBody; response: Response }
  | { ok: false; status: number; error: unknown; response: Response }

export async function fetchWithValuya<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<GuardFetchResult<T>> {
  const response = await fetch(input, init)
  const text = await response.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }

  if (response.ok) {
    return { ok: true, status: response.status, data: (json ?? text) as T, response }
  }

  if (response.status === 402 && json?.error === "payment_required") {
    return { ok: false, status: 402, payment: json as PaymentRequiredBody, response }
  }

  return { ok: false, status: response.status, error: json ?? text, response }
}

export function redirectToPayment(payment: PaymentRequiredBody) {
  if (!payment.payment_url) throw new Error("payment_url_missing")
  window.location.href = payment.payment_url
}
