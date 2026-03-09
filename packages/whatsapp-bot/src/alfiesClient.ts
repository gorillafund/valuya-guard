export type AlfiesAddressInput = {
  line1: string
  house: string
  postcode: string
  city: string
  latitude: number
  longitude: number
  phone?: string
  notes?: string
  shippingMethod?: string
  query?: string
}

export type AlfiesBasketProductInput = {
  id: number
  quantity: number
  affiliateId?: string | number | null
}

export type AlfiesShippingMethodRequest = {
  shippingAddress: AlfiesAddressInput
  shippingDate: string
}

export type AlfiesCheckoutPayload = Record<string, unknown>

type FetchLike = typeof fetch

export class AlfiesClient {
  private readonly baseUrl: string
  private readonly countryCode: string
  private readonly locale?: string
  private readonly fetchImpl: FetchLike
  private token?: string
  private sessionId?: string

  constructor(args?: {
    baseUrl?: string
    countryCode?: string
    locale?: string
    token?: string
    sessionId?: string
    fetchImpl?: FetchLike
  }) {
    this.baseUrl = (args?.baseUrl || "https://test-api.alfies.shop/api/v1").replace(/\/+$/, "")
    this.countryCode = String(args?.countryCode || "AT").trim() || "AT"
    this.locale = args?.locale?.trim()
    this.token = args?.token?.trim()
    this.sessionId = args?.sessionId?.trim()
    this.fetchImpl = args?.fetchImpl || fetch
  }

  getSessionState(): { token?: string; sessionId?: string } {
    return {
      ...(this.token ? { token: this.token } : {}),
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
    }
  }

  async login(email: string, password: string): Promise<unknown> {
    const body = await this.request("POST", "/accounts/login/", {
      email,
      password,
    })
    const token = String((body as Record<string, unknown>)?.key || "").trim()
    if (token) this.token = token
    return body
  }

  async getSessionAddress(): Promise<unknown> {
    return this.request("GET", "/accounts/addresses/session-address")
  }

  async setSessionAddress(address: AlfiesAddressInput): Promise<unknown> {
    return this.request("POST", "/accounts/addresses/session-address", address)
  }

  async getBasket(): Promise<unknown> {
    return this.request("GET", "/basket/")
  }

  async addBasketProduct(input: AlfiesBasketProductInput): Promise<unknown> {
    return this.request("POST", "/basket/products", input)
  }

  async clearBasket(): Promise<unknown> {
    return this.request("DELETE", "/basket/remove-all-lines")
  }

  async getShippingMethods(input?: AlfiesShippingMethodRequest): Promise<unknown> {
    if (input) {
      return this.request("POST", "/basket/shipping-methods", input)
    }
    return this.request("GET", "/basket/shipping-methods")
  }

  async previewCheckout(payload: AlfiesCheckoutPayload): Promise<unknown> {
    return this.request("POST", "/checkout/preview", payload)
  }

  async getOrderStatus(orderId: number): Promise<unknown> {
    return this.request("GET", `/accounts/orders/${encodeURIComponent(String(orderId))}`)
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Country-Code": this.countryCode,
    }
    if (this.locale) {
      headers["Accept-Language"] = this.locale
    }
    if (this.token) {
      headers.Authorization = `Token ${this.token}`
    }
    if (this.sessionId) {
      headers.Cookie = `sessionid=${this.sessionId}`
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json"
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })

    this.captureSession(response)
    const parsed = await safeParseJson(response)
    if (!response.ok) {
      throw new Error(`alfies_http_${response.status}:${JSON.stringify(parsed).slice(0, 300)}`)
    }
    return parsed
  }

  private captureSession(response: Response): void {
    const setCookie = response.headers.get("set-cookie")
    if (!setCookie) return
    const match = /(?:^|,\s*)sessionid=([^;,\s]+)/i.exec(setCookie)
    if (match?.[1]) {
      this.sessionId = match[1]
    }
  }
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
