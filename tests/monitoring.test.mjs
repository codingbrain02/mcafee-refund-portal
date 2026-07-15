import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  parseMonitoringSampleRate,
  scrubMonitoringData,
  scrubMonitoringText,
} from '../shared/monitoring-scrub.js'
import { withServerMonitoring } from '../server/monitoring.js'

test('monitoring scrubber removes customer and credential data', () => {
  const scrubbed = scrubMonitoringData({
    headers: { authorization: 'Bearer secret-token', cookie: 'session=abc' },
    message: 'Contact customer@example.com at +1 (555) 123-4567 token=abc123',
    recipient: 'customer@example.com',
    url: 'https://portal.test/reset?access_token=secret&code=private',
    beneficiary: { account: '123456789' },
    metadata: { accountLast4: '6789', actorEmail: 'actor@example.com' },
  })
  const serialized = JSON.stringify(scrubbed)

  assert.doesNotMatch(serialized, /customer@example\.com/)
  assert.doesNotMatch(serialized, /555/)
  assert.doesNotMatch(serialized, /secret-token|abc123|123456789|6789|actor@example\.com|session=abc/)
  assert.match(serialized, /\[Redacted\]/)
})

test('monitoring text scrubber removes signed URL and token-shaped values', () => {
  const scrubbed = scrubMonitoringText(
    'Bearer abc.def.ghi https://portal.test/path?signature=private token=secret',
  )

  assert.doesNotMatch(scrubbed, /abc\.def\.ghi|private|token=secret/)
})

test('trace sample rates are bounded', () => {
  assert.equal(parseMonitoringSampleRate('0.2', 0), 0.2)
  assert.equal(parseMonitoringSampleRate('2', 0), 0)
  assert.equal(parseMonitoringSampleRate('invalid', 0.1), 0.1)
})

test('server monitoring wrapper returns a sanitized failure response', async () => {
  const originalConsoleError = console.error
  console.error = () => undefined
  const response = {
    body: null,
    headersSent: false,
    statusCode: null,
    json(body) {
      this.body = body
      return this
    },
    status(code) {
      this.statusCode = code
      return this
    },
  }

  try {
    const handler = withServerMonitoring(async () => {
      throw new Error('customer@example.com token=private')
    }, 'test-route')
    await handler({}, response)
  } finally {
    console.error = originalConsoleError
  }

  assert.equal(response.statusCode, 500)
  assert.deepEqual(response.body, { error: 'The requested operation is temporarily unavailable' })
})

test('monitoring configuration is optional and privacy-safe', () => {
  const frontend = readFileSync(new URL('../src/lib/monitoring.ts', import.meta.url), 'utf8')
  const health = readFileSync(new URL('../api/health.js', import.meta.url), 'utf8')
  const vercel = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')
  const environment = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
  const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')

  assert.match(frontend, /if \(!dsn\) return/)
  assert.match(frontend, /sendDefaultPii: false/)
  assert.match(health, /monitoring: isServerMonitoringEnabled/)
  assert.match(vercel, /ingest\.sentry\.io/)
  assert.match(environment, /VITE_SENTRY_DSN=\r?\n/)
  assert.match(environment, /SENTRY_AUTH_TOKEN=\r?\n/)
  assert.match(vite, /sourcemap: sentrySourceMapsEnabled \? 'hidden' : false/)
  assert.match(vite, /filesToDeleteAfterUpload/)
})
