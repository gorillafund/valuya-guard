import test from "node:test"
import assert from "node:assert/strict"
import type { CatalogQueryInterpretation } from "./openaiIntent.js"
import { explainCatalogMiss, findAlternativesForCartItems, parseResolverRules, resolveProductsFromCatalog, resolveProductsFromMessage } from "./alfiesProductResolver.js"
import type { ResolvedRecipeRequest } from "./recipeService.js"

test("parses configured resolver rules", () => {
  const rules = parseResolverRules(
    JSON.stringify([
      {
        label: "Pasta Bundle",
        match: ["pasta", "spaghetti"],
        products: [{ id: 101, quantity: 1 }, { id: 202, quantity: 2 }],
      },
    ]),
  )
  assert.equal(rules.length, 1)
  assert.equal(rules[0]?.products[1]?.id, 202)
})

test("resolves products from free text", () => {
  const rules = parseResolverRules(
    JSON.stringify([
      {
        label: "Snack Night",
        match: ["movie night", "snacks"],
        products: [{ id: 303, quantity: 1 }],
      },
    ]),
  )
  const resolved = resolveProductsFromMessage("snacks for movie night", rules)
  assert.equal(resolved?.label, "Snack Night")
  assert.equal(resolved?.lines[0]?.id, 303)
})

test("resolves products from indexed catalog keywords", () => {
  const resolved = resolveProductsFromCatalog("vegetarian pasta for 2", [
    {
      product_id: 101,
      title: "Bio Spaghetti",
      slug: "bio-spaghetti",
      price_cents: 299,
      currency: "EUR",
      keywords: ["pasta", "spaghetti"],
      category: "pasta",
      updated_at: "2026-03-09T00:00:00.000Z",
    },
    {
      product_id: 202,
      title: "Tomatensauce",
      slug: "tomatensauce",
      price_cents: 249,
      currency: "EUR",
      keywords: ["pasta", "tomato", "sauce"],
      category: "sauces",
      updated_at: "2026-03-09T00:00:00.000Z",
    },
  ])

  assert.equal(resolved?.label, "Indexed Alfies catalog for 2")
  assert.equal(resolved?.lines.length, 2)
  assert.equal(resolved?.lines[0]?.id, 101)
  assert.equal(resolved?.lines[1]?.id, 202)
  assert.equal(resolved?.lines[0]?.quantity, 1)
})

test("infers drink quantities from serving hints", () => {
  const resolved = resolveProductsFromCatalog("drinks for 3", [
    {
      product_id: 501,
      title: "Cola Zero 1L",
      slug: "cola-zero-1l",
      price_cents: 199,
      currency: "EUR",
      keywords: ["cola", "soft drink"],
      category: "drinks",
      updated_at: "2026-03-09T00:00:00.000Z",
    },
  ])

  assert.equal(resolved?.lines.length, 1)
  assert.equal(resolved?.lines[0]?.id, 501)
  assert.equal(resolved?.lines[0]?.quantity, 3)
})

test("caps shareable snack quantities", () => {
  const resolved = resolveProductsFromCatalog("movie night snacks for 5", [
    {
      product_id: 601,
      title: "Tortilla Chips",
      slug: "tortilla-chips",
      price_cents: 249,
      currency: "EUR",
      keywords: ["snacks", "chips"],
      category: "snacks",
      updated_at: "2026-03-09T00:00:00.000Z",
    },
  ])

  assert.equal(resolved?.lines.length, 1)
  assert.equal(resolved?.lines[0]?.quantity, 3)
})

test("prefers cheaper products when cheapest preference is active", () => {
  const resolved = resolveProductsFromCatalog(
    "cola",
    [
      {
        product_id: 701,
        title: "Budget Cola",
        slug: "budget-cola",
        price_cents: 129,
        currency: "EUR",
        keywords: ["cola"],
        category: "drinks",
        updated_at: "2026-03-09T00:00:00.000Z",
      },
      {
        product_id: 702,
        title: "Premium Cola",
        slug: "premium-cola",
        price_cents: 259,
        currency: "EUR",
        keywords: ["cola"],
        category: "drinks",
        updated_at: "2026-03-09T00:00:00.000Z",
      },
    ],
    { cheapest: true },
  )

  assert.equal(resolved?.lines[0]?.id, 701)
  assert.match(String(resolved?.label), /cheapest/)
})

test("prefers bio and regional products when configured", () => {
  const resolved = resolveProductsFromCatalog(
    "apple juice",
    [
      {
        product_id: 801,
        title: "Standard Apple Juice",
        slug: "standard-apple-juice",
        price_cents: 199,
        currency: "EUR",
        keywords: ["apple", "juice"],
        category: "drinks",
        updated_at: "2026-03-09T00:00:00.000Z",
      },
      {
        product_id: 802,
        title: "Bio Apfelsaft aus Oesterreich",
        slug: "bio-apfelsaft-at",
        price_cents: 249,
        currency: "EUR",
        keywords: ["apple", "juice", "bio", "oesterreich"],
        category: "drinks",
        updated_at: "2026-03-09T00:00:00.000Z",
      },
    ],
    { bio: true, regional: true },
  )

  assert.equal(resolved?.lines[0]?.id, 802)
  assert.match(String(resolved?.label), /regional/)
  assert.match(String(resolved?.label), /bio/)
})

test("matches german packaged beer requests against beer catalogue items", () => {
  const resolved = resolveProductsFromCatalog(
    "kiste bier",
    [
      {
        product_id: 901,
        title: "Helles Bier Tray 24x 0,5l",
        slug: "helles-bier-tray-24",
        price_cents: 2499,
        currency: "EUR",
        keywords: ["beer", "tray", "bundle", "helles"],
        category: "Helles & Maerzen",
        updated_at: "2026-03-09T00:00:00.000Z",
      },
    ],
  )

  assert.equal(resolved?.lines[0]?.id, 901)
})

test("uses interpreted query hints to normalize packaging requests", () => {
  const interpretedQuery: CatalogQueryInterpretation = {
    normalizedQuery: "beer crate",
    normalizedTerms: ["bier", "beer", "crate", "tray"],
    categoryHints: ["drinks", "beer"],
    packagingHint: "crate",
    quantityHint: 1,
    confidence: 0.9,
    shouldClarify: false,
  }
  const resolved = resolveProductsFromCatalog(
    "kiste bier",
    [
      {
        product_id: 903,
        title: "Bier Box",
        slug: "bier-box",
        price_cents: 1999,
        currency: "EUR",
        keywords: ["beer", "box", "bundle"],
        category: "Bier & Cider Pakete",
        updated_at: "2026-03-09T00:00:00.000Z",
      },
    ],
    undefined,
    interpretedQuery,
  )

  assert.equal(resolved?.lines[0]?.id, 903)
})

test("rejects weak recipe basket matches when required anchors are missing", () => {
  const recipeRequest: ResolvedRecipeRequest = {
    title: "Paella",
    normalizedDish: "paella",
    ingredients: ["reis", "paprika", "erbsen", "zwiebel", "knoblauch", "safran", "fond"],
    requiredAnchors: ["reis", "safran", "fond"],
  }
  const resolved = resolveProductsFromCatalog(
    "reis paprika erbsen zwiebel knoblauch safran fond",
    [
      {
        product_id: 1001,
        title: "Gemuese Fond",
        slug: "gemuese-fond",
        price_cents: 399,
        currency: "EUR",
        keywords: ["fond", "gemuese"],
        category: "Fonds",
        updated_at: "2026-03-09T00:00:00.000Z",
      },
      {
        product_id: 1002,
        title: "Hot Jalapeno Salsa",
        slug: "hot-jalapeno-salsa",
        price_cents: 650,
        currency: "EUR",
        keywords: ["paprika", "salsa"],
        category: "Saucen",
        updated_at: "2026-03-09T00:00:00.000Z",
      },
      {
        product_id: 1003,
        title: "Gemuesesuppe Wuerfel",
        slug: "gemuesesuppe-wuerfel",
        price_cents: 199,
        currency: "EUR",
        keywords: ["suppe", "gemuese"],
        category: "Suppen",
        updated_at: "2026-03-09T00:00:00.000Z",
      },
    ],
    undefined,
    undefined,
    recipeRequest,
  )

  assert.equal(resolved, null)
})

test("explains catalogue misses with concrete fallback suggestions", () => {
  const message = explainCatalogMiss("kiste bier", [
    {
      product_id: 902,
      title: "Weisswein Cuvee",
      slug: "weisswein-cuvee",
      price_cents: 1599,
      currency: "EUR",
      keywords: ["wine"],
      category: "Weissweine",
      updated_at: "2026-03-09T00:00:00.000Z",
    },
  ])

  assert.match(message, /nichts Passendes/)
  assert.match(message, /Helles & Maerzen|Bier Spezialitaeten/)
})

test("finds alternatives for current cart items instead of inventing a new basket", () => {
  const result = findAlternativesForCartItems({
    cart: {
      items: [
        { product_id: 1, sku: "vollmilch-a", name: "Stainzer Vollmilch 3,5%", qty: 3, unit_price_cents: 119, currency: "EUR" },
      ],
    },
    products: [
      {
        product_id: 1,
        title: "Stainzer Vollmilch 3,5%",
        slug: "vollmilch-a",
        price_cents: 119,
        currency: "EUR",
        keywords: ["vollmilch", "milch"],
        category: "Milch & Alternativen",
        updated_at: "2026-03-09T00:00:00.000Z",
      },
      {
        product_id: 2,
        title: "Nöm Vollmilch 3,5%",
        slug: "vollmilch-b",
        price_cents: 129,
        currency: "EUR",
        keywords: ["vollmilch", "milch"],
        category: "Milch & Alternativen",
        updated_at: "2026-03-09T00:00:00.000Z",
      },
    ],
  })

  assert.equal(result.items.length, 1)
  assert.equal(result.items[0]?.originalName, "Stainzer Vollmilch 3,5%")
  assert.equal(result.items[0]?.alternative.title, "Nöm Vollmilch 3,5%")
  assert.equal(result.items[0]?.quantity, 3)
})
