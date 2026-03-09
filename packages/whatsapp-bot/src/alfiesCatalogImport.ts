import { resolve } from "node:path"
import { readFile } from "node:fs/promises"
import { normalizeAlfiesCatalogText } from "./alfiesCatalogNormalize.js"
import { FileStateStore } from "./stateStore.js"

async function main(): Promise<void> {
  const jsonPathArg = process.argv[2]
  if (!jsonPathArg) {
    throw new Error("alfies_catalog_json_path_required")
  }

  const stateFile =
    process.argv[3] ||
    process.env.WHATSAPP_STATE_FILE?.trim() ||
    resolve(process.cwd(), ".data/whatsapp-state.sqlite")

  const jsonPath = resolve(process.cwd(), jsonPathArg)
  const raw = await readFile(jsonPath, "utf8")
  const products = normalizeAlfiesCatalogText(raw)

  if (!products.length) {
    throw new Error("alfies_catalog_no_valid_products")
  }

  const store = new FileStateStore(stateFile)
  await store.upsertAlfiesProducts(products)

  console.log(JSON.stringify({
    level: "info",
    event: "alfies_catalog_imported",
    stateFile,
    jsonPath,
    imported_products: products.length,
  }))
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(JSON.stringify({
    level: "error",
    event: "alfies_catalog_import_failed",
    message,
  }))
  process.exitCode = 1
})
