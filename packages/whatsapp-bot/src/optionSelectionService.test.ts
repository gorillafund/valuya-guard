import test from "node:test"
import assert from "node:assert/strict"
import {
  buildCartItemActionOptions,
  buildCartItemSelectionOptions,
  buildMatchingCategoryOptions,
  buildCategorySelectionOptions,
  buildProductsForCategoryOptions,
  buildProductSelectionOptions,
  buildReferenceSelectionOptions,
  extractInlineChoiceOptions,
  formatPendingOptionsMessage,
  resolvePendingOptionSelection,
} from "./optionSelectionService.js"
import type { StoredAlfiesProduct } from "./stateStore.js"

const products: StoredAlfiesProduct[] = [
  {
    product_id: 1,
    slug: "vollmilch-1l",
    title: "Vollmilch 1L",
    price_cents: 149,
    currency: "EUR",
    keywords: ["milch", "vollmilch"],
    category: "Milch & Alternativen",
    updated_at: "2026-03-09T00:00:00.000Z",
  },
  {
    product_id: 2,
    slug: "hafermilch-1l",
    title: "Hafermilch 1L",
    price_cents: 199,
    currency: "EUR",
    keywords: ["milch", "hafermilch"],
    category: "Milch & Alternativen",
    updated_at: "2026-03-09T00:00:00.000Z",
  },
  {
    product_id: 3,
    slug: "gin-london-dry",
    title: "London Dry Gin",
    price_cents: 2399,
    currency: "EUR",
    keywords: ["gin", "spirituosen"],
    category: "Gin",
    updated_at: "2026-03-09T00:00:00.000Z",
  },
  {
    product_id: 4,
    slug: "whisky-blend",
    title: "Blended Whisky",
    price_cents: 2799,
    currency: "EUR",
    keywords: ["whisky", "spirituosen"],
    category: "Whisky",
    updated_at: "2026-03-09T00:00:00.000Z",
  },
]

test("builds product options for broad variant selection", () => {
  const options = buildProductSelectionOptions({
    query: "milch",
    products,
  })
  assert.equal(options.length, 2)
  assert.equal(options[0]?.label, "Vollmilch 1L")
})

test("supports offsets for paged product options", () => {
  const options = buildProductSelectionOptions({
    query: "milch",
    products,
    offset: 1,
    limit: 1,
  })
  assert.equal(options.length, 1)
  assert.equal(options[0]?.label, "Hafermilch 1L")
})

test("resolves numeric and label-based option replies", () => {
  const options = buildProductSelectionOptions({
    query: "milch",
    products,
  })
  assert.equal(resolvePendingOptionSelection("1", { options })?.label, "Vollmilch 1L")
  assert.equal(resolvePendingOptionSelection("Hafermilch 1L", { options })?.productId, 2)
})

test("formats numbered option messages", () => {
  const message = formatPendingOptionsMessage("Welche Variante?", [
    { id: "1", label: "Vollmilch 1L", value: "Vollmilch 1L" },
    { id: "2", label: "Hafermilch 1L", value: "Hafermilch 1L" },
  ])
  assert.match(message, /1\. Vollmilch 1L/)
  assert.match(message, /Antworte mit der Nummer/)
})

test("builds category options from catalog", () => {
  const options = buildCategorySelectionOptions(products)
  assert.equal(options[0]?.label, "Milch & Alternativen")
})

test("prioritizes common shopping families in category options", () => {
  const extendedProducts: StoredAlfiesProduct[] = [
    ...products,
    {
      product_id: 10,
      slug: "bergkaese",
      title: "Bergkaese",
      price_cents: 399,
      currency: "EUR",
      keywords: ["kaese"],
      category: "Kaese",
      updated_at: "2026-03-09T00:00:00.000Z",
    },
    {
      product_id: 11,
      slug: "brot",
      title: "Bauernbrot",
      price_cents: 299,
      currency: "EUR",
      keywords: ["brot"],
      category: "Brot",
      updated_at: "2026-03-09T00:00:00.000Z",
    },
  ]
  const options = buildCategorySelectionOptions(extendedProducts, 5)
  assert.ok(options.slice(0, 3).some((option) => option.label === "Kaese"))
  assert.ok(options.slice(0, 4).some((option) => option.label === "Brot"))
})

test("matches dairy family queries to category options first", () => {
  const extendedProducts: StoredAlfiesProduct[] = [
    ...products.slice(0, 2),
    {
      product_id: 5,
      slug: "joghurt-natur",
      title: "Joghurt Natur",
      price_cents: 99,
      currency: "EUR",
      keywords: ["joghurt"],
      category: "Joghurt",
      updated_at: "2026-03-09T00:00:00.000Z",
    },
  ]
  const options = buildMatchingCategoryOptions({
    query: "zeige mir alle milchprodukte",
    products: extendedProducts,
  })
  assert.equal(options[0]?.label, "Joghurt")
  assert.ok(options.some((option) => option.label === "Milch & Alternativen"))
})

test("matches cheese family queries to cheese-like categories first", () => {
  const cheeseProducts: StoredAlfiesProduct[] = [
    ...products,
    {
      product_id: 12,
      slug: "frischkaese",
      title: "Frischkaese Natur",
      price_cents: 199,
      currency: "EUR",
      keywords: ["frischkaese", "kaese"],
      category: "Frischkaese",
      updated_at: "2026-03-09T00:00:00.000Z",
    },
  ]
  const options = buildMatchingCategoryOptions({
    query: "ich moechte kaese kaufen",
    products: cheeseProducts,
  })
  assert.ok(options.slice(0, 2).some((option) => option.label === "Frischkaese"))
})

test("builds products for selected category", () => {
  const options = buildProductsForCategoryOptions({
    category: "Milch & Alternativen",
    products,
  })
  assert.equal(options.length, 2)
  assert.equal(options[1]?.label, "Hafermilch 1L")
})

test("matches meat family queries to meat-like categories first", () => {
  const meatProducts: StoredAlfiesProduct[] = [
    ...products.slice(0, 2),
    {
      product_id: 6,
      slug: "rinderfaschiertes",
      title: "Rinderfaschiertes 500g",
      price_cents: 699,
      currency: "EUR",
      keywords: ["fleisch", "rind", "meat"],
      category: "Fleisch",
      updated_at: "2026-03-09T00:00:00.000Z",
    },
  ]
  const options = buildMatchingCategoryOptions({
    query: "ich moechte fleisch kaufen",
    products: meatProducts,
  })
  assert.equal(options[0]?.label, "Fleisch")
})

test("matches household paper family queries to household-paper categories first", () => {
  const householdProducts: StoredAlfiesProduct[] = [
    ...products,
    {
      product_id: 20,
      slug: "klopapier-4-lagig",
      title: "Klopapier 4-lagig",
      price_cents: 399,
      currency: "EUR",
      keywords: ["klopapier", "toilettenpapier"],
      category: "Toilettenpapier",
      updated_at: "2026-03-09T00:00:00.000Z",
    },
    {
      product_id: 21,
      slug: "kuechenrolle",
      title: "Kuechenrolle 4er",
      price_cents: 299,
      currency: "EUR",
      keywords: ["haushaltspapier", "kuechenrolle"],
      category: "Haushaltspapier",
      updated_at: "2026-03-09T00:00:00.000Z",
    },
  ]
  const options = buildMatchingCategoryOptions({
    query: "ich brauche klopapier",
    products: householdProducts,
  })
  assert.equal(options[0]?.label, "Toilettenpapier")
  assert.ok(options.some((option) => option.label === "Haushaltspapier"))
})

test("extracts inline choice options from clarification text", () => {
  const options = extractInlineChoiceOptions(
    "Moechten Sie Getraenke aus einer bestimmten Kategorie, wie alkoholfreie Getraenke, Bier, Wein oder Spirituosen?",
  )
  assert.deepEqual(options.map((option) => option.label), [
    "alkoholfreie Getraenke",
    "Bier",
    "Wein",
    "Spirituosen",
  ])
})

test("extracts yes no options from binary clarification", () => {
  const options = extractInlineChoiceOptions(
    "Meinen Sie Reinigungsmittel fuer die Toilette (WC-Reiniger)?",
  )
  assert.deepEqual(options.map((option) => option.label), ["Ja", "Nein"])
})

test("does not extract fake options from generic open question", () => {
  const options = extractInlineChoiceOptions(
    "Was soll ich fuer dich suchen oder zusammenstellen?",
  )
  assert.equal(options.length, 0)
})

test("builds selectable options from recommended products", () => {
  const options = buildReferenceSelectionOptions([
    { title: "Tegernseer Helles", productId: 11, sku: "tegernseer-helles" },
    { title: "Bayrische Bier Box", productId: 12, sku: "bayrische-bier-box" },
  ])
  assert.equal(options.length, 2)
  assert.equal(options[1]?.label, "Bayrische Bier Box")
  assert.equal(resolvePendingOptionSelection("2", { options })?.productId, 12)
})

test("matches spirits family queries to spirit categories", () => {
  const options = buildMatchingCategoryOptions({
    query: "Spirituosen",
    products,
  })
  assert.equal(options[0]?.label, "Gin")
  assert.ok(options.some((option) => option.label === "Whisky"))
})

test("builds cart item selection and actions", () => {
  const cartOptions = buildCartItemSelectionOptions({
    items: [
      { sku: "vollmilch-1l", name: "Vollmilch 1L", qty: 2, unit_price_cents: 149, currency: "EUR" },
    ],
  })
  assert.equal(cartOptions[0]?.value, "Vollmilch 1L")

  const actionOptions = buildCartItemActionOptions("Vollmilch 1L", cartOptions[0]!)
  assert.equal(actionOptions.length, 4)
  assert.equal(actionOptions[1]?.action, "set_quantity")
})
