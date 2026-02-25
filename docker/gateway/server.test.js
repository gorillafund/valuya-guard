import test from 'node:test'
import assert from 'node:assert/strict'
import { createGuardHandler } from './server.js'

test('gateway requires base and token env', async () => {
  assert.throws(() => createGuardHandler({}), /VALUYA_BASE and VALUYA_TENANT_TOKEN/)
})
