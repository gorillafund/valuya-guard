import { access, mkdir, readFile, rename } from "node:fs/promises"
import { dirname } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export type CartState = {
  items?: unknown[]
  total_cents?: number
  currency?: string
}

export type RecipeState = {
  title?: string
}

export type ConversationState = {
  subjectId: string
  orderId: string
  lastRecipe?: RecipeState
  lastCart?: CartState
  updatedAt: string
}

export type OnboardingStage = "new" | "guided" | "address_captured" | "active"

export type ShoppingPreferences = {
  cheapest?: boolean
  regional?: boolean
  bio?: boolean
}

export type ConversationReferenceItem = {
  productId?: number
  sku?: string
  title: string
}

export type PendingClarification = {
  kind: string
  question: string
  askedAt: string
}

export type InteractionState = {
  phase: "idle" | "browsing" | "disambiguation" | "cart_edit" | "recipe_build" | "checkout"
  last_assistant_act:
    | "asked_choice"
    | "showed_products"
    | "asked_yes_no"
    | "confirmed_mutation"
    | "suggested_recipe"
    | "asked_quantity"
    | "asked_clarification"
    | "summarized_state"
  expected_reply_type: "option_index" | "yes_no" | "quantity" | "free_text" | "none"
  repair_mode: boolean
  pending_clarification_reason?: string | null
  assumption_under_discussion?: {
    type: string
    value: string
  } | null
}

export type PaymentHandoffState = {
  status: string
  checkoutId?: string
  checkoutUrl?: string
  updatedAt: string
}

export type ActiveProductCandidate = {
  productId?: number
  sku?: string
  title: string
  unitPriceCents?: number
  currency?: string
}

export type ActiveQuestionState =
  | {
      kind: "quantity_for_product"
      productTitle: string
      packagingHint?: string
    }
  | {
      kind: "packaging_for_product"
      productTitle: string
    }
  | undefined

export type PendingOption = {
  id: string
  label: string
  value: string
  productId?: number
  sku?: string
  unitPriceCents?: number
  currency?: string
  action?: "remove" | "only" | "increase" | "set_quantity"
}

export type PendingDialog =
  | {
      kind: "preferences"
      step: "choose"
    }
  | {
      kind: "modify_or_new"
      options: ["modify_current_cart", "start_new_cart"]
      proposedMessage: string
    }
  | undefined

export type ConversationProfile = {
  deliveryAddressHint?: string
  deliveryDateHint?: string
  guidedMode?: boolean
  alfiesSessionId?: string
  alfiesAddressReady?: boolean
  alfiesShippingSummary?: string
  shoppingPreferences?: ShoppingPreferences
  pendingDialog?: PendingDialog
  latestMessage?: string
  recentConversationHistory?: string[]
  extractedIntent?: string
  extractedEntities?: Record<string, unknown>
  lastShownProducts?: ConversationReferenceItem[]
  selectedRecipeTitle?: string
  currentCartSnapshot?: CartState
  pendingClarification?: PendingClarification
  interactionState?: InteractionState
  paymentHandoffState?: PaymentHandoffState
  activeProductCandidate?: ActiveProductCandidate
  activeQuestion?: ActiveQuestionState
  activeEditMode?: "replace_with_single_product" | "add_to_existing_cart" | "update_existing_item_quantity"
  pendingOptions?: {
    kind: "product_selection" | "category_selection" | "cart_item_selection" | "cart_item_action" | "occasion_selection"
    prompt: string
    options: PendingOption[]
    offset?: number
    sourceQuery?: string
    sourceCategory?: string
    selectionMode?: "replace_with_single_product" | "add_to_existing_cart"
  }
}

export type StoredChannelLink = {
  whatsapp_user_id: string
  whatsapp_profile_name?: string
  tenant_id?: string
  channel_app_id: string
  valuya_subject_id?: string
  valuya_subject_type?: string
  valuya_subject_external_id?: string
  valuya_privy_user_id?: string
  valuya_linked_wallet_address?: string
  valuya_privy_wallet_id?: string
  valuya_protocol_subject_type?: string
  valuya_protocol_subject_id?: string
  valuya_protocol_subject_header?: string
  status: string
  linked_at: string
  meta?: Record<string, unknown>
  updated_at: string
}

export type StoredMarketplaceOrderLink = {
  local_order_id: string
  valuya_order_id: string
  checkout_url: string
  guard_subject_id?: string
  guard_subject_type?: string
  guard_subject_external_id?: string
  protocol_subject_header: string
  amount_cents: number
  currency: string
  status?: string
  updated_at: string
}

export type StoredAlfiesProduct = {
  product_id: number
  slug?: string
  title: string
  price_cents?: number
  currency?: string
  keywords: string[]
  category?: string
  availability_json?: Record<string, unknown>
  updated_at: string
}

export type StoredRecipe = {
  recipe_id: string
  slug: string
  title: string
  cuisine?: string
  source?: string
  source_url?: string
  aliases: string[]
  instructions_short?: string[]
  updated_at: string
}

export type StoredRecipeIngredient = {
  recipe_id: string
  name: string
  quantity?: string
  unit?: string
  sort_order: number
}

export type StoredUnderstandingEvent = {
  event_id: string
  subject_id: string
  channel: string
  user_message: string
  context_summary?: string
  extraction_json?: Record<string, unknown>
  route_kind: string
  route_action?: string
  reference_status?: string
  pending_options_kind?: string
  active_edit_mode?: string
  feedback_signal?: string
  created_at: string
}

export type StoredUnderstandingEvalCase = {
  case_id: string
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
  notes?: string
  created_at: string
  updated_at: string
}

type SqliteRow = Record<string, unknown>
type LegacyPersistedState = {
  conversations?: Record<string, ConversationState>
  channelLinks?: Record<string, StoredChannelLink>
  marketplaceOrderLinks?: Record<string, StoredMarketplaceOrderLink>
}

export class FileStateStore {
  private readonly filePath: string
  private initPromise: Promise<void> | null = null

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async get(subjectId: string): Promise<ConversationState | null> {
    await this.ensureReady()
    const rows = await this.query(
      `select subject_id, order_id, last_recipe_json, last_cart_json, updated_at
       from conversations
       where subject_id = ${sqlString(subjectId)}
       limit 1;`,
    )
    const row = rows[0]
    if (!row) return null
    return {
      subjectId: String(row.subject_id || ""),
      orderId: String(row.order_id || ""),
      lastRecipe: parseJsonObject<RecipeState>(row.last_recipe_json),
      lastCart: parseJsonObject<CartState>(row.last_cart_json),
      updatedAt: String(row.updated_at || ""),
    }
  }

  async upsert(subjectId: string, patch: Partial<ConversationState>): Promise<ConversationState> {
    await this.ensureReady()
    const current = await this.get(subjectId)
    const merged: ConversationState = {
      subjectId,
      orderId: patch.orderId ?? current?.orderId ?? "",
      lastRecipe: patch.lastRecipe ?? current?.lastRecipe,
      lastCart: patch.lastCart ?? current?.lastCart,
      updatedAt: new Date().toISOString(),
    }

    if (!merged.orderId.trim()) {
      throw new Error("state_order_id_required")
    }

    await this.exec(
      `insert into conversations (
         subject_id, order_id, last_recipe_json, last_cart_json, updated_at
       ) values (
         ${sqlString(subjectId)},
         ${sqlString(merged.orderId)},
         ${sqlJson(merged.lastRecipe)},
         ${sqlJson(merged.lastCart)},
         ${sqlString(merged.updatedAt)}
       )
       on conflict(subject_id) do update set
         order_id = excluded.order_id,
         last_recipe_json = excluded.last_recipe_json,
         last_cart_json = excluded.last_cart_json,
         updated_at = excluded.updated_at;`,
    )
    return merged
  }

  async delete(subjectId: string): Promise<void> {
    await this.ensureReady()
    await this.exec(`delete from conversations where subject_id = ${sqlString(subjectId)};`)
  }

  async getProfile(subjectId: string): Promise<{
    subjectId: string
    onboardingStage?: OnboardingStage
    profile?: ConversationProfile
    updatedAt: string
  } | null> {
    await this.ensureReady()
    const rows = await this.query(
      `select subject_id, onboarding_stage, profile_json, updated_at
       from conversation_profiles
       where subject_id = ${sqlString(subjectId)}
       limit 1;`,
    )
    const row = rows[0]
    if (!row) return null
    return {
      subjectId: String(row.subject_id || ""),
      onboardingStage: readOptionalString(row.onboarding_stage) as OnboardingStage | undefined,
      profile: parseJsonObject<ConversationProfile>(row.profile_json),
      updatedAt: String(row.updated_at || ""),
    }
  }

  async upsertProfile(subjectId: string, patch: {
    onboardingStage?: OnboardingStage
    profile?: ConversationProfile
  }): Promise<{
    subjectId: string
    onboardingStage?: OnboardingStage
    profile?: ConversationProfile
    updatedAt: string
  }> {
    await this.ensureReady()
    const current = await this.getProfile(subjectId)
    const merged = {
      subjectId,
      onboardingStage: patch.onboardingStage ?? current?.onboardingStage ?? "guided",
      profile: patch.profile
        ? { ...(current?.profile || {}), ...patch.profile }
        : current?.profile,
      updatedAt: new Date().toISOString(),
    }

    await this.exec(
      `insert into conversation_profiles (
         subject_id, onboarding_stage, profile_json, updated_at
       ) values (
         ${sqlString(subjectId)},
         ${sqlStringOrNull(merged.onboardingStage)},
         ${sqlJson(merged.profile)},
         ${sqlString(merged.updatedAt)}
       )
       on conflict(subject_id) do update set
         onboarding_stage = excluded.onboarding_stage,
         profile_json = excluded.profile_json,
         updated_at = excluded.updated_at;`,
    )
    return merged
  }

  async getChannelLink(whatsappUserId: string): Promise<StoredChannelLink | null> {
    await this.ensureReady()
    const rows = await this.query(
      `select * from channel_links
       where whatsapp_user_id = ${sqlString(whatsappUserId)}
       limit 1;`,
    )
    const row = rows[0]
    if (!row) return null
    return mapChannelLinkRow(row)
  }

  async upsertChannelLink(whatsappUserId: string, patch: Partial<StoredChannelLink>): Promise<StoredChannelLink> {
    await this.ensureReady()
    const current = await this.getChannelLink(whatsappUserId)
    const now = new Date().toISOString()
    const merged: StoredChannelLink = {
      whatsapp_user_id: patch.whatsapp_user_id ?? current?.whatsapp_user_id ?? whatsappUserId,
      whatsapp_profile_name: patch.whatsapp_profile_name ?? current?.whatsapp_profile_name,
      tenant_id: patch.tenant_id ?? current?.tenant_id,
      channel_app_id: patch.channel_app_id ?? current?.channel_app_id ?? "whatsapp_main",
      valuya_subject_id: patch.valuya_subject_id ?? current?.valuya_subject_id,
      valuya_subject_type: patch.valuya_subject_type ?? current?.valuya_subject_type,
      valuya_subject_external_id: patch.valuya_subject_external_id ?? current?.valuya_subject_external_id,
      valuya_privy_user_id: patch.valuya_privy_user_id ?? current?.valuya_privy_user_id,
      valuya_linked_wallet_address: patch.valuya_linked_wallet_address ?? current?.valuya_linked_wallet_address,
      valuya_privy_wallet_id: patch.valuya_privy_wallet_id ?? current?.valuya_privy_wallet_id,
      valuya_protocol_subject_type:
        patch.valuya_protocol_subject_type ?? current?.valuya_protocol_subject_type,
      valuya_protocol_subject_id:
        patch.valuya_protocol_subject_id ?? current?.valuya_protocol_subject_id,
      valuya_protocol_subject_header:
        patch.valuya_protocol_subject_header ?? current?.valuya_protocol_subject_header,
      status: patch.status ?? current?.status ?? "linked",
      linked_at: patch.linked_at ?? current?.linked_at ?? now,
      meta: patch.meta ? { ...(current?.meta || {}), ...patch.meta } : current?.meta,
      updated_at: now,
    }

    if (!merged.whatsapp_user_id.trim()) throw new Error("state_whatsapp_user_id_required")
    if (!merged.channel_app_id.trim()) throw new Error("state_channel_app_id_required")
    if (!merged.status.trim()) throw new Error("state_channel_link_status_required")

    await this.exec(
      `insert into channel_links (
         whatsapp_user_id, whatsapp_profile_name, tenant_id, channel_app_id,
         valuya_subject_id, valuya_subject_type, valuya_subject_external_id,
         valuya_privy_user_id, valuya_linked_wallet_address, valuya_privy_wallet_id,
         valuya_protocol_subject_type, valuya_protocol_subject_id, valuya_protocol_subject_header,
         status, linked_at, meta_json, updated_at
       ) values (
         ${sqlString(merged.whatsapp_user_id)},
         ${sqlStringOrNull(merged.whatsapp_profile_name)},
         ${sqlStringOrNull(merged.tenant_id)},
         ${sqlString(merged.channel_app_id)},
         ${sqlStringOrNull(merged.valuya_subject_id)},
         ${sqlStringOrNull(merged.valuya_subject_type)},
         ${sqlStringOrNull(merged.valuya_subject_external_id)},
         ${sqlStringOrNull(merged.valuya_privy_user_id)},
         ${sqlStringOrNull(merged.valuya_linked_wallet_address)},
         ${sqlStringOrNull(merged.valuya_privy_wallet_id)},
         ${sqlStringOrNull(merged.valuya_protocol_subject_type)},
         ${sqlStringOrNull(merged.valuya_protocol_subject_id)},
         ${sqlStringOrNull(merged.valuya_protocol_subject_header)},
         ${sqlString(merged.status)},
         ${sqlString(merged.linked_at)},
         ${sqlJson(merged.meta)},
         ${sqlString(merged.updated_at)}
       )
       on conflict(whatsapp_user_id) do update set
         whatsapp_profile_name = excluded.whatsapp_profile_name,
         tenant_id = excluded.tenant_id,
         channel_app_id = excluded.channel_app_id,
         valuya_subject_id = excluded.valuya_subject_id,
         valuya_subject_type = excluded.valuya_subject_type,
         valuya_subject_external_id = excluded.valuya_subject_external_id,
         valuya_privy_user_id = excluded.valuya_privy_user_id,
         valuya_linked_wallet_address = excluded.valuya_linked_wallet_address,
         valuya_privy_wallet_id = excluded.valuya_privy_wallet_id,
         valuya_protocol_subject_type = excluded.valuya_protocol_subject_type,
         valuya_protocol_subject_id = excluded.valuya_protocol_subject_id,
         valuya_protocol_subject_header = excluded.valuya_protocol_subject_header,
         status = excluded.status,
         linked_at = excluded.linked_at,
         meta_json = excluded.meta_json,
         updated_at = excluded.updated_at;`,
    )

    return merged
  }

  async upsertMarketplaceOrderLink(
    localOrderId: string,
    patch: Omit<StoredMarketplaceOrderLink, "local_order_id" | "updated_at">,
  ): Promise<StoredMarketplaceOrderLink> {
    await this.ensureReady()
    const merged: StoredMarketplaceOrderLink = {
      local_order_id: localOrderId,
      valuya_order_id: String(patch.valuya_order_id || "").trim(),
      checkout_url: String(patch.checkout_url || "").trim(),
      guard_subject_id: patch.guard_subject_id,
      guard_subject_type: patch.guard_subject_type,
      guard_subject_external_id: patch.guard_subject_external_id,
      protocol_subject_header: String(patch.protocol_subject_header || "").trim(),
      amount_cents: Math.trunc(Number(patch.amount_cents || 0)),
      currency: String(patch.currency || "").trim() || "EUR",
      status: patch.status,
      updated_at: new Date().toISOString(),
    }

    if (!merged.valuya_order_id) throw new Error("marketplace_order_id_required")
    if (!merged.checkout_url) throw new Error("marketplace_checkout_url_required")
    if (!merged.protocol_subject_header) throw new Error("marketplace_protocol_subject_required")
    if (!Number.isFinite(merged.amount_cents) || merged.amount_cents <= 0) {
      throw new Error("marketplace_amount_required")
    }

    await this.exec(
      `insert into marketplace_order_links (
         local_order_id, valuya_order_id, checkout_url,
         guard_subject_id, guard_subject_type, guard_subject_external_id,
         protocol_subject_header, amount_cents, currency, status, updated_at
       ) values (
         ${sqlString(merged.local_order_id)},
         ${sqlString(merged.valuya_order_id)},
         ${sqlString(merged.checkout_url)},
         ${sqlStringOrNull(merged.guard_subject_id)},
         ${sqlStringOrNull(merged.guard_subject_type)},
         ${sqlStringOrNull(merged.guard_subject_external_id)},
         ${sqlString(merged.protocol_subject_header)},
         ${merged.amount_cents},
         ${sqlString(merged.currency)},
         ${sqlStringOrNull(merged.status)},
         ${sqlString(merged.updated_at)}
       )
       on conflict(local_order_id) do update set
         valuya_order_id = excluded.valuya_order_id,
         checkout_url = excluded.checkout_url,
         guard_subject_id = excluded.guard_subject_id,
         guard_subject_type = excluded.guard_subject_type,
         guard_subject_external_id = excluded.guard_subject_external_id,
         protocol_subject_header = excluded.protocol_subject_header,
         amount_cents = excluded.amount_cents,
         currency = excluded.currency,
         status = excluded.status,
         updated_at = excluded.updated_at;`,
    )

    return merged
  }

  async getMarketplaceOrderLink(localOrderId: string): Promise<StoredMarketplaceOrderLink | null> {
    await this.ensureReady()
    const rows = await this.query(
      `select * from marketplace_order_links
       where local_order_id = ${sqlString(localOrderId)}
       limit 1;`,
    )
    const row = rows[0]
    if (!row) return null
    return {
      local_order_id: String(row.local_order_id || ""),
      valuya_order_id: String(row.valuya_order_id || ""),
      checkout_url: String(row.checkout_url || ""),
      guard_subject_id: readOptionalString(row.guard_subject_id),
      guard_subject_type: readOptionalString(row.guard_subject_type),
      guard_subject_external_id: readOptionalString(row.guard_subject_external_id),
      protocol_subject_header: String(row.protocol_subject_header || ""),
      amount_cents: toInt(row.amount_cents) || 0,
      currency: String(row.currency || "EUR"),
      status: readOptionalString(row.status),
      updated_at: String(row.updated_at || ""),
    }
  }

  async upsertAlfiesProducts(products: Array<Omit<StoredAlfiesProduct, "updated_at">>): Promise<void> {
    await this.ensureReady()
    const now = new Date().toISOString()
    for (const product of products) {
      await this.exec(
        `insert into alfies_products (
           product_id, slug, title, price_cents, currency, keywords_json, category, availability_json, updated_at
         ) values (
           ${Math.trunc(product.product_id)},
           ${sqlStringOrNull(product.slug)},
           ${sqlString(product.title)},
           ${typeof product.price_cents === "number" ? Math.trunc(product.price_cents) : "null"},
           ${sqlStringOrNull(product.currency)},
           ${sqlJson(product.keywords)},
           ${sqlStringOrNull(product.category)},
           ${sqlJson(product.availability_json)},
           ${sqlString(now)}
         )
         on conflict(product_id) do update set
           slug = excluded.slug,
           title = excluded.title,
           price_cents = excluded.price_cents,
           currency = excluded.currency,
           keywords_json = excluded.keywords_json,
           category = excluded.category,
           availability_json = excluded.availability_json,
           updated_at = excluded.updated_at;`,
      )
    }
  }

  async listAlfiesProducts(): Promise<StoredAlfiesProduct[]> {
    await this.ensureReady()
    const rows = await this.query(
      `select product_id, slug, title, price_cents, currency, keywords_json, category, availability_json, updated_at
       from alfies_products
       order by title asc;`,
    )
    return rows.map((row) => ({
      product_id: toInt(row.product_id) || 0,
      slug: readOptionalString(row.slug),
      title: String(row.title || ""),
      price_cents: toInt(row.price_cents),
      currency: readOptionalString(row.currency),
      keywords: parseJsonObject<string[]>(row.keywords_json) || [],
      category: readOptionalString(row.category),
      availability_json: parseJsonObject<Record<string, unknown>>(row.availability_json),
      updated_at: String(row.updated_at || ""),
    }))
  }

  async upsertRecipes(recipes: Array<StoredRecipe & { ingredients: StoredRecipeIngredient[] }>): Promise<void> {
    await this.ensureReady()
    for (const recipe of recipes) {
      await this.exec(
        `insert into recipes (
           recipe_id, slug, title, cuisine, source, source_url, aliases_json, instructions_json, updated_at
         ) values (
           ${sqlString(recipe.recipe_id)},
           ${sqlString(recipe.slug)},
           ${sqlString(recipe.title)},
           ${sqlStringOrNull(recipe.cuisine)},
           ${sqlStringOrNull(recipe.source)},
           ${sqlStringOrNull(recipe.source_url)},
           ${sqlJson(recipe.aliases || [])},
           ${sqlJson(recipe.instructions_short || [])},
           ${sqlString(recipe.updated_at)}
         )
         on conflict(recipe_id) do update set
           slug = excluded.slug,
           title = excluded.title,
           cuisine = excluded.cuisine,
           source = excluded.source,
           source_url = excluded.source_url,
           aliases_json = excluded.aliases_json,
           instructions_json = excluded.instructions_json,
           updated_at = excluded.updated_at;`,
      )
      await this.exec(`delete from recipe_ingredients where recipe_id = ${sqlString(recipe.recipe_id)};`)
      for (const ingredient of recipe.ingredients || []) {
        await this.exec(
          `insert into recipe_ingredients (
             recipe_id, ingredient_name, quantity, unit, sort_order
           ) values (
             ${sqlString(recipe.recipe_id)},
             ${sqlString(ingredient.name)},
             ${sqlStringOrNull(ingredient.quantity)},
             ${sqlStringOrNull(ingredient.unit)},
             ${Math.trunc(Number(ingredient.sort_order || 0))}
           );`,
        )
      }
    }
  }

  async listRecipes(): Promise<Array<StoredRecipe & { ingredients: StoredRecipeIngredient[] }>> {
    await this.ensureReady()
    const recipes = await this.query(
      `select recipe_id, slug, title, cuisine, source, source_url, aliases_json, instructions_json, updated_at
       from recipes
       order by title asc;`,
    )
    const ingredients = await this.query(
      `select recipe_id, ingredient_name, quantity, unit, sort_order
       from recipe_ingredients
       order by recipe_id asc, sort_order asc;`,
    )
    const byRecipe = new Map<string, StoredRecipeIngredient[]>()
    for (const row of ingredients) {
      const recipeId = String(row.recipe_id || "")
      if (!recipeId) continue
      const list = byRecipe.get(recipeId) || []
      list.push({
        recipe_id: recipeId,
        name: String(row.ingredient_name || ""),
        quantity: readOptionalString(row.quantity),
        unit: readOptionalString(row.unit),
        sort_order: toInt(row.sort_order) || 0,
      })
      byRecipe.set(recipeId, list)
    }
    return recipes.map((row) => ({
      recipe_id: String(row.recipe_id || ""),
      slug: String(row.slug || ""),
      title: String(row.title || ""),
      cuisine: readOptionalString(row.cuisine),
      source: readOptionalString(row.source),
      source_url: readOptionalString(row.source_url),
      aliases: parseJsonObject<string[]>(row.aliases_json) || [],
      instructions_short: parseJsonObject<string[]>(row.instructions_json) || [],
      updated_at: String(row.updated_at || ""),
      ingredients: byRecipe.get(String(row.recipe_id || "")) || [],
    }))
  }

  async appendUnderstandingEvent(
    event: StoredUnderstandingEvent,
  ): Promise<void> {
    await this.ensureReady()
    await this.exec(
      `insert into understanding_events (
         event_id, subject_id, channel, user_message, context_summary,
         extraction_json, route_kind, route_action, reference_status,
         pending_options_kind, active_edit_mode, feedback_signal, created_at
       ) values (
         ${sqlString(event.event_id)},
         ${sqlString(event.subject_id)},
         ${sqlString(event.channel)},
         ${sqlString(event.user_message)},
         ${sqlStringOrNull(event.context_summary)},
         ${sqlJson(event.extraction_json)},
         ${sqlString(event.route_kind)},
         ${sqlStringOrNull(event.route_action)},
         ${sqlStringOrNull(event.reference_status)},
         ${sqlStringOrNull(event.pending_options_kind)},
         ${sqlStringOrNull(event.active_edit_mode)},
         ${sqlStringOrNull(event.feedback_signal)},
         ${sqlString(event.created_at)}
       );`,
    )
  }

  async listUnderstandingEvents(args?: {
    limit?: number
    feedbackOnly?: boolean
  }): Promise<StoredUnderstandingEvent[]> {
    await this.ensureReady()
    const limit = Math.max(1, Math.min(5000, Math.trunc(Number(args?.limit || 100))))
    const feedbackWhere = args?.feedbackOnly ? "where feedback_signal is not null" : ""
    const rows = await this.query(
      `select event_id, subject_id, channel, user_message, context_summary,
              extraction_json, route_kind, route_action, reference_status,
              pending_options_kind, active_edit_mode, feedback_signal, created_at
       from understanding_events
       ${feedbackWhere}
       order by created_at desc
       limit ${limit};`,
    )
    return rows.map((row) => ({
      event_id: String(row.event_id || ""),
      subject_id: String(row.subject_id || ""),
      channel: String(row.channel || ""),
      user_message: String(row.user_message || ""),
      context_summary: readOptionalString(row.context_summary),
      extraction_json: parseJsonObject<Record<string, unknown>>(row.extraction_json),
      route_kind: String(row.route_kind || ""),
      route_action: readOptionalString(row.route_action),
      reference_status: readOptionalString(row.reference_status),
      pending_options_kind: readOptionalString(row.pending_options_kind),
      active_edit_mode: readOptionalString(row.active_edit_mode),
      feedback_signal: readOptionalString(row.feedback_signal),
      created_at: String(row.created_at || ""),
    }))
  }

  async upsertUnderstandingEvalCase(
    patch: Omit<StoredUnderstandingEvalCase, "created_at" | "updated_at"> & { created_at?: string },
  ): Promise<StoredUnderstandingEvalCase> {
    await this.ensureReady()
    const now = new Date().toISOString()
    const merged: StoredUnderstandingEvalCase = {
      case_id: String(patch.case_id || "").trim(),
      name: String(patch.name || "").trim(),
      message: String(patch.message || "").trim(),
      context_summary: patch.context_summary?.trim() || undefined,
      expected_intent: patch.expected_intent?.trim() || undefined,
      expected_route_kind: patch.expected_route_kind?.trim() || undefined,
      expected_route_action: patch.expected_route_action?.trim() || undefined,
      expected_selection_mode:
        patch.expected_selection_mode === "replace_with_single_product" ||
        patch.expected_selection_mode === "add_to_existing_cart"
          ? patch.expected_selection_mode
          : undefined,
      expected_should_clarify:
        typeof patch.expected_should_clarify === "boolean"
          ? patch.expected_should_clarify
          : undefined,
      expected_family: patch.expected_family?.trim() || undefined,
      expected_categories: Array.isArray(patch.expected_categories)
        ? patch.expected_categories.map((value) => String(value || "").trim()).filter(Boolean)
        : undefined,
      catastrophic_mismatch:
        typeof patch.catastrophic_mismatch === "boolean"
          ? patch.catastrophic_mismatch
          : undefined,
      notes: patch.notes?.trim() || undefined,
      created_at: patch.created_at || now,
      updated_at: now,
    }
    if (!merged.case_id) throw new Error("understanding_eval_case_id_required")
    if (!merged.name) throw new Error("understanding_eval_case_name_required")
    if (!merged.message) throw new Error("understanding_eval_case_message_required")
    await this.exec(
      `insert into understanding_eval_cases (
         case_id, name, message, context_summary, expected_intent,
         expected_route_kind, expected_route_action, expected_selection_mode,
         expected_should_clarify, expected_family, expected_categories_json,
         catastrophic_mismatch, notes, created_at, updated_at
       ) values (
         ${sqlString(merged.case_id)},
         ${sqlString(merged.name)},
         ${sqlString(merged.message)},
         ${sqlStringOrNull(merged.context_summary)},
         ${sqlStringOrNull(merged.expected_intent)},
         ${sqlStringOrNull(merged.expected_route_kind)},
         ${sqlStringOrNull(merged.expected_route_action)},
         ${sqlStringOrNull(merged.expected_selection_mode)},
         ${typeof merged.expected_should_clarify === "boolean" ? (merged.expected_should_clarify ? "1" : "0") : "null"},
         ${sqlStringOrNull(merged.expected_family)},
         ${sqlJson(merged.expected_categories)},
         ${typeof merged.catastrophic_mismatch === "boolean" ? (merged.catastrophic_mismatch ? "1" : "0") : "null"},
         ${sqlStringOrNull(merged.notes)},
         ${sqlString(merged.created_at)},
         ${sqlString(merged.updated_at)}
       )
       on conflict(case_id) do update set
         name = excluded.name,
         message = excluded.message,
         context_summary = excluded.context_summary,
         expected_intent = excluded.expected_intent,
         expected_route_kind = excluded.expected_route_kind,
         expected_route_action = excluded.expected_route_action,
         expected_selection_mode = excluded.expected_selection_mode,
         expected_should_clarify = excluded.expected_should_clarify,
         expected_family = excluded.expected_family,
         expected_categories_json = excluded.expected_categories_json,
         catastrophic_mismatch = excluded.catastrophic_mismatch,
         notes = excluded.notes,
         updated_at = excluded.updated_at;`,
    )
    return merged
  }

  async listUnderstandingEvalCases(limit = 1000): Promise<StoredUnderstandingEvalCase[]> {
    await this.ensureReady()
    const safeLimit = Math.max(1, Math.min(5000, Math.trunc(Number(limit || 1000))))
    const rows = await this.query(
      `select case_id, name, message, context_summary, expected_intent,
              expected_route_kind, expected_route_action, expected_selection_mode,
              expected_should_clarify, expected_family, expected_categories_json,
              catastrophic_mismatch, notes, created_at, updated_at
       from understanding_eval_cases
       order by updated_at desc
       limit ${safeLimit};`,
    )
    return rows.map((row) => ({
      case_id: String(row.case_id || ""),
      name: String(row.name || ""),
      message: String(row.message || ""),
      context_summary: readOptionalString(row.context_summary),
      expected_intent: readOptionalString(row.expected_intent),
      expected_route_kind: readOptionalString(row.expected_route_kind),
      expected_route_action: readOptionalString(row.expected_route_action),
      expected_selection_mode: readOptionalString(row.expected_selection_mode) as StoredUnderstandingEvalCase["expected_selection_mode"],
      expected_should_clarify: readOptionalBoolean(row.expected_should_clarify),
      expected_family: readOptionalString(row.expected_family),
      expected_categories: parseJsonObject<string[]>(row.expected_categories_json),
      catastrophic_mismatch: readOptionalBoolean(row.catastrophic_mismatch),
      notes: readOptionalString(row.notes),
      created_at: String(row.created_at || ""),
      updated_at: String(row.updated_at || ""),
    }))
  }

  private async ensureReady(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initialize()
    }
    await this.initPromise
  }

  private async initialize(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const legacy = await this.readLegacyJsonStateIfPresent()
    try {
      await access(this.filePath)
    } catch {
      // sqlite3 will create the file on first write
    }
    await this.exec(`
      pragma journal_mode = wal;
      create table if not exists conversations (
        subject_id text primary key,
        order_id text not null,
        last_recipe_json text,
        last_cart_json text,
        updated_at text not null
      );
      create table if not exists channel_links (
        whatsapp_user_id text primary key,
        whatsapp_profile_name text,
        tenant_id text,
        channel_app_id text not null,
        valuya_subject_id text,
        valuya_subject_type text,
        valuya_subject_external_id text,
        valuya_privy_user_id text,
        valuya_linked_wallet_address text,
        valuya_privy_wallet_id text,
        valuya_protocol_subject_type text,
        valuya_protocol_subject_id text,
        valuya_protocol_subject_header text,
        status text not null,
        linked_at text not null,
        meta_json text,
        updated_at text not null
      );
      create table if not exists conversation_profiles (
        subject_id text primary key,
        onboarding_stage text,
        profile_json text,
        updated_at text not null
      );
      create table if not exists marketplace_order_links (
        local_order_id text primary key,
        valuya_order_id text not null,
        checkout_url text not null,
        guard_subject_id text,
        guard_subject_type text,
        guard_subject_external_id text,
        protocol_subject_header text not null,
        amount_cents integer not null,
        currency text not null,
        status text,
        updated_at text not null
      );
      create table if not exists alfies_products (
        product_id integer primary key,
        slug text,
        title text not null,
        price_cents integer,
        currency text,
        keywords_json text,
        category text,
        availability_json text,
        updated_at text not null
      );
      create table if not exists recipes (
        recipe_id text primary key,
        slug text not null,
        title text not null,
        cuisine text,
        source text,
        source_url text,
        aliases_json text,
        instructions_json text,
        updated_at text not null
      );
      create table if not exists recipe_ingredients (
        recipe_id text not null,
        ingredient_name text not null,
        quantity text,
        unit text,
        sort_order integer not null default 0
      );
      create table if not exists understanding_events (
        event_id text primary key,
        subject_id text not null,
        channel text not null,
        user_message text not null,
        context_summary text,
        extraction_json text,
        route_kind text not null,
        route_action text,
        reference_status text,
        pending_options_kind text,
        active_edit_mode text,
        feedback_signal text,
        created_at text not null
      );
      create index if not exists idx_understanding_events_created_at on understanding_events(created_at desc);
      create index if not exists idx_understanding_events_feedback on understanding_events(feedback_signal);
      create table if not exists understanding_eval_cases (
        case_id text primary key,
        name text not null,
        message text not null,
        context_summary text,
        expected_intent text,
        expected_route_kind text,
        expected_route_action text,
        expected_selection_mode text,
        expected_should_clarify integer,
        expected_family text,
        expected_categories_json text,
        catastrophic_mismatch integer,
        notes text,
        created_at text not null,
        updated_at text not null
      );
    `)
    if (legacy) {
      await this.importLegacyState(legacy)
    }
  }

  private async exec(sql: string): Promise<void> {
    await execFileAsync("sqlite3", [this.filePath, sql], { maxBuffer: 4 * 1024 * 1024 })
  }

  private async query(sql: string): Promise<SqliteRow[]> {
    const { stdout } = await execFileAsync("sqlite3", ["-json", this.filePath, sql], {
      maxBuffer: 4 * 1024 * 1024,
    })
    const text = stdout.trim()
    if (!text) return []
    return JSON.parse(text) as SqliteRow[]
  }

  private async readLegacyJsonStateIfPresent(): Promise<LegacyPersistedState | null> {
    let raw: string
    try {
      raw = await readFile(this.filePath, "utf8")
    } catch {
      return null
    }

    const trimmed = raw.trim()
    if (!trimmed) return null
    if (trimmed.startsWith("SQLite format 3")) return null

    let parsed: LegacyPersistedState
    try {
      parsed = JSON.parse(trimmed) as LegacyPersistedState
    } catch {
      return null
    }

    const backupPath = `${this.filePath}.legacy.json`
    await rename(this.filePath, backupPath)
    return {
      conversations: parsed.conversations ?? {},
      channelLinks: parsed.channelLinks ?? {},
      marketplaceOrderLinks: parsed.marketplaceOrderLinks ?? {},
    }
  }

  private async importLegacyState(legacy: LegacyPersistedState): Promise<void> {
    for (const [subjectId, conversation] of Object.entries(legacy.conversations ?? {})) {
      if (!conversation?.orderId) continue
      await this.exec(
        `insert or replace into conversations (
           subject_id, order_id, last_recipe_json, last_cart_json, updated_at
         ) values (
           ${sqlString(subjectId)},
           ${sqlString(String(conversation.orderId))},
           ${sqlJson(conversation.lastRecipe)},
           ${sqlJson(conversation.lastCart)},
           ${sqlString(conversation.updatedAt || new Date().toISOString())}
         );`,
      )
    }

    for (const [whatsappUserId, link] of Object.entries(legacy.channelLinks ?? {})) {
      if (!link?.channel_app_id || !link?.status) continue
      await this.exec(
        `insert or replace into channel_links (
           whatsapp_user_id, whatsapp_profile_name, tenant_id, channel_app_id,
           valuya_subject_id, valuya_subject_type, valuya_subject_external_id,
           valuya_privy_user_id, valuya_linked_wallet_address, valuya_privy_wallet_id,
           valuya_protocol_subject_type, valuya_protocol_subject_id, valuya_protocol_subject_header,
           status, linked_at, meta_json, updated_at
         ) values (
           ${sqlString(whatsappUserId)},
           ${sqlStringOrNull(link.whatsapp_profile_name)},
           ${sqlStringOrNull(link.tenant_id)},
           ${sqlString(link.channel_app_id)},
           ${sqlStringOrNull(link.valuya_subject_id)},
           ${sqlStringOrNull(link.valuya_subject_type)},
           ${sqlStringOrNull(link.valuya_subject_external_id)},
           ${sqlStringOrNull(link.valuya_privy_user_id)},
           ${sqlStringOrNull(link.valuya_linked_wallet_address)},
           ${sqlStringOrNull(link.valuya_privy_wallet_id)},
           ${sqlStringOrNull(link.valuya_protocol_subject_type)},
           ${sqlStringOrNull(link.valuya_protocol_subject_id)},
           ${sqlStringOrNull(link.valuya_protocol_subject_header)},
           ${sqlString(link.status)},
           ${sqlString(link.linked_at || new Date().toISOString())},
           ${sqlJson(link.meta)},
           ${sqlString(link.updated_at || new Date().toISOString())}
         );`,
      )
    }

    for (const [localOrderId, link] of Object.entries(legacy.marketplaceOrderLinks ?? {})) {
      if (!link?.valuya_order_id || !link?.checkout_url || !link?.protocol_subject_header) continue
      await this.exec(
        `insert or replace into marketplace_order_links (
           local_order_id, valuya_order_id, checkout_url,
           guard_subject_id, guard_subject_type, guard_subject_external_id,
           protocol_subject_header, amount_cents, currency, status, updated_at
         ) values (
           ${sqlString(localOrderId)},
           ${sqlString(link.valuya_order_id)},
           ${sqlString(link.checkout_url)},
           ${sqlStringOrNull(link.guard_subject_id)},
           ${sqlStringOrNull(link.guard_subject_type)},
           ${sqlStringOrNull(link.guard_subject_external_id)},
           ${sqlString(link.protocol_subject_header)},
           ${Math.trunc(Number(link.amount_cents || 0))},
           ${sqlString(link.currency || "EUR")},
           ${sqlStringOrNull(link.status)},
           ${sqlString(link.updated_at || new Date().toISOString())}
         );`,
      )
    }
  }
}

function mapChannelLinkRow(row: SqliteRow): StoredChannelLink {
  return {
    whatsapp_user_id: String(row.whatsapp_user_id || ""),
    whatsapp_profile_name: readOptionalString(row.whatsapp_profile_name),
    tenant_id: readOptionalString(row.tenant_id),
    channel_app_id: String(row.channel_app_id || ""),
    valuya_subject_id: readOptionalString(row.valuya_subject_id),
    valuya_subject_type: readOptionalString(row.valuya_subject_type),
    valuya_subject_external_id: readOptionalString(row.valuya_subject_external_id),
    valuya_privy_user_id: readOptionalString(row.valuya_privy_user_id),
    valuya_linked_wallet_address: readOptionalString(row.valuya_linked_wallet_address),
    valuya_privy_wallet_id: readOptionalString(row.valuya_privy_wallet_id),
    valuya_protocol_subject_type: readOptionalString(row.valuya_protocol_subject_type),
    valuya_protocol_subject_id: readOptionalString(row.valuya_protocol_subject_id),
    valuya_protocol_subject_header: readOptionalString(row.valuya_protocol_subject_header),
    status: String(row.status || ""),
    linked_at: String(row.linked_at || ""),
    meta: parseJsonObject<Record<string, unknown>>(row.meta_json),
    updated_at: String(row.updated_at || ""),
  }
}

function sqlString(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`
}

function sqlStringOrNull(value: string | undefined): string {
  return typeof value === "string" && value.trim() ? sqlString(value) : "null"
}

function sqlJson(value: unknown): string {
  return value === undefined ? "null" : sqlString(JSON.stringify(value))
}

function parseJsonObject<T>(value: unknown): T | undefined {
  const raw = readOptionalString(value)
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : undefined
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase()
    if (trimmed === "1" || trimmed === "true") return true
    if (trimmed === "0" || trimmed === "false") return false
  }
  return undefined
}

export function normalizeCart(input: unknown): CartState | undefined {
  if (!input || typeof input !== "object") return undefined
  const obj = input as Record<string, unknown>

  const cart: CartState = {}
  if (Array.isArray(obj.items)) cart.items = obj.items

  const total = toInt(obj.total_cents)
  if (typeof total === "number") cart.total_cents = total

  const currency = String(obj.currency ?? "").trim()
  if (currency) cart.currency = currency

  return Object.keys(cart).length > 0 ? cart : undefined
}

export function normalizeRecipe(input: unknown): RecipeState | undefined {
  if (!input || typeof input !== "object") return undefined
  const title = String((input as Record<string, unknown>).title ?? "").trim()
  return title ? { title } : undefined
}

function toInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === "string" && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return Math.trunc(n)
  }
  return undefined
}
