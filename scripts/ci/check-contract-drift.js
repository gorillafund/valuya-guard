#!/usr/bin/env node
const fs = require('fs')

const canonicalPath = 'docs/protocol/canonical.md'
const openapiPath = 'openapi/v2.yaml'

for (const p of [canonicalPath, openapiPath]) {
  if (!fs.existsSync(p)) {
    console.error(`missing ${p}`)
    process.exit(1)
  }
}

const canonical = fs.readFileSync(canonicalPath, 'utf8')
const openapi = fs.readFileSync(openapiPath, 'utf8')

const endpoints = [
  ['/api/v2/entitlements', '/api/v2/entitlements'],
  ['/api/v2/checkout/sessions', '/api/v2/checkout/sessions'],
  ['/api/v2/checkout/sessions/{session_id}', '/api/v2/checkout/sessions/'],
  ['/api/v2/agent/sessions/{session_id}/tx', '/api/v2/agent/sessions/'],
  ['/api/v2/agent/sessions/{session_id}/verify', '/api/v2/agent/sessions/'],
]

let ok = true
for (const [openapiEndpoint, canonicalNeedle] of endpoints) {
  const canonicalHas = canonical.includes(canonicalNeedle)
  const openapiHas = openapi.includes(openapiEndpoint)
  if (!canonicalHas || !openapiHas) {
    ok = false
    console.error(`drift: endpoint not present in both sources: ${openapiEndpoint}`)
  }
}

if (!canonical.includes('302') || !canonical.includes('402')) {
  ok = false
  console.error('drift: canonical doc must specify 302/402 behavior')
}

if (!ok) process.exit(1)
console.log('contract drift checks passed')
