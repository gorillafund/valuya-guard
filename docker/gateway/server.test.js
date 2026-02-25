import test from 'node:test'
import assert from 'node:assert/strict'
import { createGuardHandler } from './server.js'

function mockRes() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers = {}) {
      this.status = status
      this.headers = headers
    },
    end(chunk = '') {
      this.body = String(chunk)
    }
  }
}

test('returns 404 for unknown path', async () => {
  const handler = createGuardHandler({
    VALUYA_BASE: 'https://pay.example',
    VALUYA_TENANT_TOKEN: 'ttok',
  })

  const req = { url: '/x', method: 'GET', headers: {} }
  const res = mockRes()
  await handler(req, res)
  assert.equal(res.status, 404)
})

test('returns 402 JSON when inactive and API request', async () => {
  const originalFetch = global.fetch
  global.fetch = async (url, init) => {
    if (String(url).includes('/entitlements')) {
      return { ok: true, text: async () => JSON.stringify({ active: false, reason: 'subscription_inactive', required: { type: 'subscription', plan: 'standard' }, evaluated_plan: 'standard' }) }
    }
    if (String(url).includes('/checkout/sessions')) {
      return { ok: true, text: async () => JSON.stringify({ session_id: 'cs_1', payment_url: 'https://pay.example/cs_1' }) }
    }
    return { ok: false, status: 500, text: async () => 'error' }
  }

  const handler = createGuardHandler({
    VALUYA_BASE: 'https://pay.example',
    VALUYA_TENANT_TOKEN: 'ttok',
    VALUYA_WEB_REDIRECT: 'true',
  })

  const req = {
    url: '/guard/check',
    method: 'GET',
    headers: {
      accept: 'application/json',
      'x-valuya-subject-id': 'user:1',
      'x-original-method': 'GET',
      'x-original-path': '/premium',
    },
  }
  const res = mockRes()
  await handler(req, res)

  assert.equal(res.status, 402)
  const body = JSON.parse(res.body)
  assert.equal(body.error, 'payment_required')
  assert.equal(body.session_id, 'cs_1')

  global.fetch = originalFetch
})
