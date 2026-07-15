import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  canCreatePortalRole,
  getBearerToken,
  getJsonBody,
  getValidUuid,
} from '../server/security.js'

test('accepts valid UUIDs and rejects malformed identifiers', () => {
  assert.equal(
    getValidUuid('123e4567-e89b-42d3-a456-426614174000'),
    '123e4567-e89b-42d3-a456-426614174000',
  )
  assert.equal(getValidUuid('../private-document'), null)
})

test('extracts only bearer authorization tokens', () => {
  assert.equal(getBearerToken({ headers: { authorization: 'Bearer portal-token' } }), 'portal-token')
  assert.equal(getBearerToken({ headers: { authorization: 'Basic portal-token' } }), null)
})

test('handles JSON request bodies without throwing', () => {
  assert.deepEqual(getJsonBody({ body: '{"documentId":"abc"}' }), { documentId: 'abc' })
  assert.deepEqual(getJsonBody({ body: '{invalid' }), {})
})

test('enforces staff account creation role boundaries', () => {
  const portalAdministrator = {
    email: 'jccodingbrain@gmail.com',
    role: 'administrator',
  }
  const administrator = {
    email: 'site.manager@example.com',
    role: 'administrator',
  }
  const refundManager = {
    email: 'refund.manager@example.com',
    role: 'refund_manager',
  }

  assert.equal(canCreatePortalRole(portalAdministrator, 'administrator'), true)
  assert.equal(canCreatePortalRole(portalAdministrator, 'refund_manager'), true)
  assert.equal(canCreatePortalRole(administrator, 'customer'), true)
  assert.equal(canCreatePortalRole(administrator, 'refund_manager'), true)
  assert.equal(canCreatePortalRole(administrator, 'administrator'), false)
  assert.equal(canCreatePortalRole(refundManager, 'customer'), false)
})

test('public registration remains customer-only', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')

  assert.match(app, /async function handleSignUp/)
  assert.match(app, /Create customer account/)
  assert.match(schema, /else 'customer'::public\.user_role/)
})

test('deployment configuration contains core browser protections', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
  const headers = config.headers[0].headers
  const names = new Set(headers.map((header) => header.key))

  assert.equal(names.has('Content-Security-Policy'), true)
  assert.equal(names.has('Strict-Transport-Security'), true)
  assert.equal(names.has('X-Content-Type-Options'), true)
  assert.equal(names.has('X-Frame-Options'), true)
})

test('security migration restricts storage uploads and rate-limit execution', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20260715023000_security_hardening.sql', import.meta.url),
    'utf8',
  )

  assert.match(migration, /authorized users can upload refund documents/)
  assert.match(migration, /grant execute[\s\S]*to service_role/)
  assert.match(migration, /alter table public\.api_rate_limits enable row level security/)
})
