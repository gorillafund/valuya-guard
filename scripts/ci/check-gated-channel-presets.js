#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..', '..')

const checks = [
  { env: 'packages/whatsapp-bot-channel/.env.example', channel: 'whatsapp' },
  { env: 'packages/telegram-bot-channel/.env.example', channel: 'telegram' },
  { env: 'packages/whatsapp-bot-channel/.env.mentor.example', channel: 'whatsapp' },
  { env: 'packages/whatsapp-bot-channel/.env.support.example', channel: 'whatsapp' },
  { env: 'packages/whatsapp-bot-channel/.env.concierge.example', channel: 'whatsapp' },
  { env: 'packages/telegram-bot-channel/.env.mentor.example', channel: 'telegram' },
  { env: 'packages/telegram-bot-channel/.env.support.example', channel: 'telegram' },
  { env: 'packages/telegram-bot-channel/.env.concierge.example', channel: 'telegram' },
]

let ok = true

for (const check of checks) {
  const envPath = path.join(repoRoot, check.env)
  if (!fs.existsSync(envPath)) {
    ok = false
    console.error(`missing env file: ${check.env}`)
    continue
  }

  const env = parseEnvFile(envPath)
  const findings = validateChannel(check.channel, env)
  const errors = findings.filter((finding) => finding.severity === 'error')

  if (errors.length > 0) {
    ok = false
    console.error(`gated channel preset invalid: ${check.env}`)
    for (const error of errors) console.error(`  - ${error.message}`)
    continue
  }

  console.log(`ok ${check.channel} ${check.env}`)
}

if (!ok) process.exit(1)
console.log('gated channel preset checks passed')

function parseEnvFile(filePath) {
  const env = {}
  const raw = fs.readFileSync(filePath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex <= 0) continue
    env[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1)
  }
  return env
}

function validateChannel(channel, env) {
  const findings = []
  const requiredBase = channel === 'whatsapp'
    ? ['VALUYA_BASE', 'VALUYA_TENANT_TOKEN', 'WHATSAPP_CHANNEL_APP_ID']
    : ['VALUYA_BASE', 'VALUYA_TENANT_TOKEN', 'TELEGRAM_CHANNEL_APP_ID']

  for (const key of requiredBase) {
    if (!readValue(env, key)) findings.push({ severity: 'error', message: `${key} missing` })
  }

  if (channel === 'telegram' && !readValue(env, 'TELEGRAM_LINKS_FILE')) {
    findings.push({ severity: 'error', message: 'TELEGRAM_LINKS_FILE missing' })
  }

  const mode = readMode(channel, env)
  if (mode !== 'agent') return findings

  const soulIdKey = channel === 'whatsapp' ? 'WHATSAPP_CHANNEL_SOUL_ID' : 'TELEGRAM_CHANNEL_SOUL_ID'
  if (!readValue(env, soulIdKey)) findings.push({ severity: 'error', message: `${soulIdKey} missing` })

  const provider = readProvider(channel, env)
  if (provider === 'openai') {
    if (!readValue(env, 'OPENAI_API_KEY')) findings.push({ severity: 'error', message: 'OPENAI_API_KEY missing for openai provider' })
  } else {
    const webhookUrlKey = channel === 'whatsapp' ? 'WHATSAPP_CHANNEL_SOUL_WEBHOOK_URL' : 'TELEGRAM_CHANNEL_SOUL_WEBHOOK_URL'
    const webhookTimeoutKey = channel === 'whatsapp' ? 'WHATSAPP_CHANNEL_SOUL_WEBHOOK_TIMEOUT_MS' : 'TELEGRAM_CHANNEL_SOUL_WEBHOOK_TIMEOUT_MS'
    const webhookHeadersKey = channel === 'whatsapp' ? 'WHATSAPP_CHANNEL_SOUL_WEBHOOK_HEADERS_JSON' : 'TELEGRAM_CHANNEL_SOUL_WEBHOOK_HEADERS_JSON'

    if (!readValue(env, webhookUrlKey)) findings.push({ severity: 'error', message: `${webhookUrlKey} missing for external runtime provider` })

    const timeout = readValue(env, webhookTimeoutKey)
    if (timeout && Number.isNaN(Number(timeout))) {
      findings.push({ severity: 'error', message: `${webhookTimeoutKey} must be numeric` })
    }

    const headers = readValue(env, webhookHeadersKey)
    if (headers) {
      try {
        const parsed = JSON.parse(headers)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          findings.push({ severity: 'error', message: `${webhookHeadersKey} must be a JSON object` })
        }
      } catch {
        findings.push({ severity: 'error', message: `${webhookHeadersKey} must be valid JSON` })
      }
    }
  }

  if (channel === 'whatsapp') {
    const twilioValidate = String(readValue(env, 'TWILIO_VALIDATE_SIGNATURE') || '').toLowerCase()
    if (twilioValidate === 'true' && !readValue(env, 'TWILIO_AUTH_TOKEN')) {
      findings.push({ severity: 'error', message: 'TWILIO_AUTH_TOKEN missing while TWILIO_VALIDATE_SIGNATURE=true' })
    }
  }

  return findings
}

function readMode(channel, env) {
  const key = channel === 'whatsapp' ? 'WHATSAPP_CHANNEL_MODE' : 'TELEGRAM_CHANNEL_MODE'
  return String(readValue(env, key) || 'human').trim().toLowerCase() === 'agent' ? 'agent' : 'human'
}

function readProvider(channel, env) {
  const key = channel === 'whatsapp' ? 'WHATSAPP_CHANNEL_SOUL_PROVIDER' : 'TELEGRAM_CHANNEL_SOUL_PROVIDER'
  const value = String(readValue(env, key) || 'openai').trim().toLowerCase()
  return value || 'openai'
}

function readValue(env, key) {
  const value = env[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
