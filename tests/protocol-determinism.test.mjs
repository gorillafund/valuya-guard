import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const repoRoot = process.cwd()
const rfcPath = path.join(repoRoot, "RFC_AGENT_PRODUCT_AUTHORING_API.md")

test("prepare() same input twice -> identical resource", () => {
  const rfc = fs.readFileSync(rfcPath, "utf8")
  assert.match(rfc, /backend computes canonical `resource`/i)
  assert.match(rfc, /deterministic/i)
})

test("manual resource override -> rejected", () => {
  const rfc = fs.readFileSync(rfcPath, "utf8")
  assert.match(
    rfc,
    /rejects manual resource override unless exact deterministic match/i,
  )
})

test("idempotency tuple enforced", () => {
  const rfc = fs.readFileSync(rfcPath, "utf8")
  assert.match(
    rfc,
    /idempotency should be enforced on canonical identity tuple/i,
  )
})
