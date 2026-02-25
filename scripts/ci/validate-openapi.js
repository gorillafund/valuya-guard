#!/usr/bin/env node
const fs = require('fs')

const file = 'openapi/v2.yaml'
if (!fs.existsSync(file)) {
  console.error(`missing ${file}`)
  process.exit(1)
}

const raw = fs.readFileSync(file, 'utf8')
const required = [
  'openapi: 3.1.0',
  '/api/v2/entitlements:',
  '/api/v2/checkout/sessions:',
  '/api/v2/checkout/sessions/{session_id}:',
  '/api/v2/agent/sessions/{session_id}/tx:',
  '/api/v2/agent/sessions/{session_id}/verify:',
]

const missing = required.filter((p) => !raw.includes(p))
if (missing.length) {
  console.error('openapi missing required entries:')
  for (const m of missing) console.error(`- ${m}`)
  process.exit(1)
}

console.log('openapi structural checks passed')
