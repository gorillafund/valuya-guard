// packages/agent/src/client/http.ts

import type { AgentConfig, HttpMethod } from "../types.js"
import { buildApiError } from "./errors.js"

export async function apiJson<T>(args: {
  cfg: AgentConfig
  method: HttpMethod
  path: string
  body?: any
  headers?: Record<string, string>
}): Promise<T> {
  const url = joinUrl(args.cfg.base, args.path)

  const res = await fetch(url, {
    method: args.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.cfg.tenant_token}`,
      ...(args.headers ?? {}),
    },
    body: args.body ? JSON.stringify(args.body) : undefined,
  })

  const text = await res.text()

  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }

  if (!res.ok) {
    // ✅ throw rich typed error
    throw await buildApiError({
      res,
      method: args.method,
      url,
      path: args.path,
      responseText: text,
    })
  }

  return (json ?? ({} as any)) as T
}

function joinUrl(base: string, path: string): string {
  const b = String(base).replace(/\/+$/, "")
  const p = path.startsWith("/") ? path : `/${path}`
  return `${b}${p}`
}
