import assert from 'node:assert/strict'

export async function runContractSuite({ name, invoke, arrange }) {
  await testCase(`${name}: allow response`, async () => {
    const state = arrange({ mode: 'allow' })
    const res = await invoke(state, { accept: 'application/json', subjectId: 'user:123', path: '/premium', method: 'GET' })
    assert.equal(res.status, 200)
  })

  await testCase(`${name}: deny response with checkout`, async () => {
    const state = arrange({ mode: 'deny' })
    const res = await invoke(state, { accept: 'application/json', subjectId: 'user:123', path: '/premium', method: 'GET' })
    assert.equal(res.status, 402)
    assert.equal(res.body.error, 'payment_required')
    assert.ok(res.body.payment_url)
    assert.ok(res.body.session_id)
  })

  await testCase(`${name}: HTML triggers redirect`, async () => {
    const state = arrange({ mode: 'deny' })
    const res = await invoke(state, { accept: 'text/html', subjectId: 'user:123', path: '/premium', method: 'GET' })
    assert.equal(res.status, 302)
    assert.ok(res.headers.location)
  })

  await testCase(`${name}: JSON triggers 402`, async () => {
    const state = arrange({ mode: 'deny' })
    const res = await invoke(state, { accept: 'application/json', subjectId: 'user:123', path: '/premium', method: 'GET' })
    assert.equal(res.status, 402)
  })

  await testCase(`${name}: missing subject fails closed`, async () => {
    const state = arrange({ mode: 'deny' })
    const res = await invoke(state, { accept: 'application/json', subjectId: '', path: '/premium', method: 'GET' })
    assert.equal(res.status, 503)
  })

  await testCase(`${name}: backend timeout fails closed`, async () => {
    const state = arrange({ mode: 'timeout' })
    const res = await invoke(state, { accept: 'application/json', subjectId: 'user:123', path: '/premium', method: 'GET' })
    assert.equal(res.status, 503)
  })

  await testCase(`${name}: invalid tenant token fails closed`, async () => {
    const state = arrange({ mode: 'invalid_token' })
    const res = await invoke(state, { accept: 'application/json', subjectId: 'user:123', path: '/premium', method: 'GET' })
    assert.equal(res.status, 503)
  })
}

async function testCase(name, fn) {
  try {
    await fn()
    console.log(`ok - ${name}`)
  } catch (err) {
    console.error(`not ok - ${name}`)
    throw err
  }
}
