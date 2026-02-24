import type { AgentConfig } from "../types.js"
import { apiJson } from "../client/http.js"
import { ROUTES } from "../client/routes.js"

export type PricingModality =
  | "subscription"
  | "one_time"
  | "usage"
  | "seat_subscription"
  | string

export type AgentProductType = {
  key: string
  label?: string
  description?: string
  pricing_modalities?: PricingModality[]
  requires?: string[]
}

export type AgentProductTypesResponse = {
  ok?: boolean
  types?: AgentProductType[]
}

export type AgentProductSchemaResponse = {
  ok?: boolean
  type?: string
  json_schema?: Record<string, any> | null
  examples?: any[] | null
  pricing_modalities?: PricingModality[]
}

export type AgentProductPrepareResponse = {
  ok?: boolean
  product?: any
  resource?: string | null
  warnings?: string[]
}

export async function listProductTypes(args: {
  cfg: AgentConfig
}): Promise<AgentProductTypesResponse> {
  return apiJson<AgentProductTypesResponse>({
    cfg: args.cfg,
    method: "GET",
    path: ROUTES.agentProductsTypes,
  })
}

export async function getProductCreateSchema(args: {
  cfg: AgentConfig
  type: string
}): Promise<AgentProductSchemaResponse> {
  const t = encodeURIComponent(String(args.type))
  return apiJson<AgentProductSchemaResponse>({
    cfg: args.cfg,
    method: "GET",
    path: `${ROUTES.agentProductsSchema}/${t}`,
  })
}

export async function prepareProductForCreate(args: {
  cfg: AgentConfig
  payload: Record<string, any>
}): Promise<AgentProductPrepareResponse> {
  return apiJson<AgentProductPrepareResponse>({
    cfg: args.cfg,
    method: "POST",
    path: ROUTES.agentProductsPrepare,
    body: { draft: args.payload },
  })
}
