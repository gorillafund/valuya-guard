import test from "node:test"
import assert from "node:assert/strict"
import { normalizeAlfiesCatalog, normalizeAlfiesCatalogText } from "./alfiesCatalogNormalize.js"

test("normalizes loose catalog exports into importer shape", () => {
  const normalized = normalizeAlfiesCatalog([
    {
      id: 101,
      name: " Bio Spaghetti 500g ",
      slug: "bio-spaghetti-500g",
      price: 2.99,
      currency: "eur",
      category_name: "Pasta",
      brand: "Alfies Bio",
      tags: ["Italian", "Dry Pasta"],
      available: true,
    },
  ])

  assert.equal(normalized.length, 1)
  assert.equal(normalized[0]?.product_id, 101)
  assert.equal(normalized[0]?.title, "Bio Spaghetti 500g")
  assert.equal(normalized[0]?.price_cents, 299)
  assert.equal(normalized[0]?.currency, "EUR")
  assert.equal(normalized[0]?.category, "Pasta")
  assert.equal(normalized[0]?.availability_json?.available, true)
  assert.match((normalized[0]?.keywords || []).join(","), /spaghetti/)
  assert.match((normalized[0]?.keywords || []).join(","), /italian/)
})

test("normalizes alfies api product list format directly", () => {
  const normalized = normalizeAlfiesCatalog([
    {
      id: 777,
      slug: "coca-cola-zero-1l",
      title: "Coca-Cola Zero",
      productTitle: "Coca-Cola Zero 1L",
      priceInclTax: 2.49,
      priceCurrency: "eur",
      availability: {
        inStock: true,
      },
      categories: [
        {
          id: 9,
          slug: "drinks",
          name: "Drinks",
          parentSlug: "beverages",
          path: [],
        },
      ],
    },
  ])

  assert.equal(normalized.length, 1)
  assert.equal(normalized[0]?.product_id, 777)
  assert.equal(normalized[0]?.title, "Coca-Cola Zero")
  assert.equal(normalized[0]?.price_cents, 249)
  assert.equal(normalized[0]?.currency, "EUR")
  assert.equal(normalized[0]?.category, "Drinks")
  assert.equal(normalized[0]?.availability_json?.inStock, true)
  assert.match((normalized[0]?.keywords || []).join(","), /drinks/)
  assert.match((normalized[0]?.keywords || []).join(","), /beverages/)
  assert.match((normalized[0]?.keywords || []).join(","), /zero/)
})

test("normalizes real alfies warehouse payload shape", () => {
  const normalized = normalizeAlfiesCatalog([
    {
      id: 348396,
      slug: "brauhaus-gusswerk-guli-cola-orange-bio-mehrwegflasche-033l-1",
      title: "Brauhaus Gusswerk Guli Cola-Orange Bio",
      description: "Die oesterreichische Limo mit viel Fruchtsaft.",
      attributes: {
        brand: "Brauhaus Gusswerk Guli",
        focusKeyword: "Brauhaus Gusswerk Guli Cola-Orange Bio",
        searchTags: ["Erfrischung", "Cola", "Orangenlimo", "Limo", "Spezi"],
        nutritionType: ["Bio"],
        country: "AT",
      },
      categories: [
        {
          id: 5486,
          name: "Spezi & Colamix",
          slug: "spezi-colamix",
          path: [
            { id: 5475, name: "Limos & Eistee", slug: "limos-eistee" },
            { id: 5248, name: "Getraenke", slug: "beverages" },
          ],
        },
      ],
      whs: {
        grill: {
          availability: {
            numAvailable: 54,
            isPublic: true,
            hasAvailableStock: true,
          },
          price: 1.09,
          currency: "EUR",
        },
      },
    },
  ])

  assert.equal(normalized.length, 1)
  assert.equal(normalized[0]?.product_id, 348396)
  assert.equal(normalized[0]?.price_cents, 109)
  assert.equal(normalized[0]?.currency, "EUR")
  assert.equal(normalized[0]?.category, "Spezi & Colamix")
  assert.equal(normalized[0]?.availability_json?.hasAvailableStock, true)
  assert.match((normalized[0]?.keywords || []).join(","), /cola/)
  assert.match((normalized[0]?.keywords || []).join(","), /spezi/)
  assert.match((normalized[0]?.keywords || []).join(","), /beverages/)
  assert.match((normalized[0]?.keywords || []).join(","), /bio/)
})

test("keeps explicit price_cents and keywords when already normalized", () => {
  const normalized = normalizeAlfiesCatalog([
    {
      product_id: 202,
      title: "Tomatensauce",
      price_cents: 249,
      currency: "EUR",
      category: "Sauces",
      keywords: ["tomato", "sauce"],
    },
  ])

  assert.equal(normalized[0]?.product_id, 202)
  assert.equal(normalized[0]?.price_cents, 249)
  assert.match((normalized[0]?.keywords || []).join(","), /sauce/)
  assert.match((normalized[0]?.keywords || []).join(","), /tomato/)
  assert.match((normalized[0]?.keywords || []).join(","), /tomatensauce/)
})

test("reads top-level products wrapper", () => {
  const normalized = normalizeAlfiesCatalog({
    products: [
      {
        id: 101,
        title: "Bio Spaghetti",
        whs: {
          grill: {
            price: 2.99,
            currency: "EUR",
            availability: { hasAvailableStock: true },
          },
        },
      },
    ],
  })

  assert.equal(normalized.length, 1)
  assert.equal(normalized[0]?.product_id, 101)
  assert.equal(normalized[0]?.price_cents, 299)
})

test("reads concatenated json documents with products arrays", () => {
  const normalized = normalizeAlfiesCatalogText([
    JSON.stringify({ products: [{ id: 1, title: "A", whs: { grill: { price: 1.5, currency: "EUR" } } }] }),
    JSON.stringify({ products: [{ id: 2, title: "B", whs: { grill: { price: 2.5, currency: "EUR" } } }] }),
  ].join("\n"))

  assert.equal(normalized.length, 2)
  assert.equal(normalized[0]?.product_id, 1)
  assert.equal(normalized[1]?.product_id, 2)
})
