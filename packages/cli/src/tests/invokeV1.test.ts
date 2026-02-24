import test from "node:test"
import assert from "node:assert/strict"
import {
  executeInvokeV1,
  resolveAccessPlan,
  type InvokeV1Spec,
} from "../lib/invokeV1.js"
import { backendErrorHint } from "../lib/backendErrors.js"

test("invoke v1 executes exactly once on success", async () => {
  let calls = 0
  const fetchMock = (async () => {
    calls += 1
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as unknown as typeof fetch

  const spec: InvokeV1Spec = {
    version: "1",
    method: "POST",
    url: "https://example.test/invoke",
    headers: { "content-type": "application/json" },
    body: { a: 1 },
    timeout_ms: 1000,
    retry_policy: { max_attempts: 2, backoff_ms: [0] },
  }

  const res = await executeInvokeV1({ invoke: spec, fetchImpl: fetchMock })
  assert.equal(calls, 1)
  assert.equal(res.status, 200)
  assert.equal(res.retry_count, 0)
  assert.deepEqual(res.body, { ok: true })
})

test("invoke v1 retries once on transient 503 and then succeeds", async () => {
  let calls = 0
  const fetchMock = (async () => {
    calls += 1
    if (calls === 1) return new Response("temporary", { status: 503 })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as unknown as typeof fetch

  const spec: InvokeV1Spec = {
    version: "1",
    method: "POST",
    url: "https://example.test/invoke",
    retry_policy: { max_attempts: 2, backoff_ms: [0] },
  }

  const res = await executeInvokeV1({ invoke: spec, fetchImpl: fetchMock })
  assert.equal(calls, 2)
  assert.equal(res.status, 200)
  assert.equal(res.retry_count, 1)
})

test("no invoke gives graceful visit/none fallback", () => {
  const p1 = resolveAccessPlan({
    invoke: null,
    visitUrl: "https://example.test/resource",
  })
  assert.equal(p1.kind, "visit")

  const p2 = resolveAccessPlan({
    invoke: null,
    visitUrl: null,
    overrideUrl: "",
  })
  assert.equal(p2.kind, "none")
})

test("known backend errors map to actionable hints", () => {
  assert.match(
    backendErrorHint("product_not_found") ?? "",
    /products:list/,
  )
  assert.equal(backendErrorHint("some_unknown_code"), null)
})

