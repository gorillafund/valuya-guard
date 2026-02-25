import test from 'node:test'
import assert from 'node:assert/strict'
import { createGuardHandler } from '../../docker/gateway/server.js'
import { runContractSuite } from './harness.mjs'

function createState(mode) {
  const env = {
    VALUYA_BASE: 'https://pay.example',
    VALUYA_TENANT_TOKEN: 'ttok',
    VALUYA_PLAN: 'standard',
    VALUYA_WEB_REDIRECT: 'true',
    VALUYA_TIMEOUT_MS: '10',
    VALUYA_RETRY_MAX_ATTEMPTS: '1',
  }

  const originalFetch = global.fetch
  global.fetch = async (url) => {
    if (mode === 'timeout') {
      throw new Error('network_timeout')
    }
    if (mode === 'invalid_token') {
      return makeResp(false, 401, '{"ok":false,"error":"tenant_token_required"}')
    }

    if (String(url).includes('/entitlements')) {
      if (mode === 'allow') return makeResp(true, 200, '{"active":true,"evaluated_plan":"standard"}')
      return makeResp(true, 200, '{"active":false,"reason":"subscription_inactive","required":{"type":"subscription","plan":"standard"},"evaluated_plan":"standard"}')
    }

    if (String(url).includes('/checkout/sessions')) {
      return makeResp(true, 200, '{"session_id":"cs_1","payment_url":"https://pay.example/cs_1"}')
    }

    return makeResp(false, 500, '{}')
  }

  const handler = createGuardHandler(env)
  return { handler, restore: () => { global.fetch = originalFetch } }
}

function makeResp(ok, status, text) {
  return { ok, status, text: async () => text }
}

async function invoke(state, reqArgs) {
  const req = {
    url: '/guard/check',
    method: reqArgs.method,
    headers: {
      accept: reqArgs.accept,
      'x-original-method': reqArgs.method,
      'x-original-path': reqArgs.path,
      ...(reqArgs.subjectId ? { 'x-valuya-subject-id': reqArgs.subjectId } : {}),
    },
  }

  const res = {
    status: 0,
    headers: {},
    rawBody: '',
    writeHead(status, headers = {}) { this.status = status; this.headers = headers },
    end(chunk = '') { this.rawBody = String(chunk) },
  }

  await state.handler(req, res)
  let body = null
  try { body = res.rawBody ? JSON.parse(res.rawBody) : null } catch { body = null }
  return { status: res.status, headers: res.headers, body }
}

test('gateway contract suite', async () => {
  await runContractSuite({
    name: 'gateway',
    arrange: ({ mode }) => createState(mode),
    invoke: async (state, reqArgs) => {
      try {
        return await invoke(state, reqArgs)
      } finally {
        state.restore()
      }
    },
  })
})

test('gateway health endpoint', async () => {
  const state = createState('allow')
  const req = { url: '/healthz', method: 'GET', headers: {} }
  const res = {
    status: 0,
    headers: {},
    rawBody: '',
    writeHead(status, headers = {}) { this.status = status; this.headers = headers },
    end(chunk = '') { this.rawBody = String(chunk) },
  }

  await state.handler(req, res)
  state.restore()

  assert.equal(res.status, 200)
  assert.ok(res.rawBody.includes('valuya-guard-gateway'))
})
