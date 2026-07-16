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

test('portal account deletion covers current user-linked records and reports modal errors', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const migration = readFileSync(
    new URL('../supabase/migrations/20260716131000_delete_user_storage_api.sql', import.meta.url),
    'utf8',
  )
  const accountMigration = readFileSync(
    new URL('../supabase/migrations/20260716130000_fix_complete_user_deletion.sql', import.meta.url),
    'utf8',
  )
  const endpoint = readFileSync(new URL('../api/delete-user.js', import.meta.url), 'utf8')

  assert.match(accountMigration, /if not public\.is_portal_administrator\(\)/)
  assert.match(migration, /update public\.refund_requests request[\s\S]*eligible_order_id = null/)
  assert.match(migration, /delete from public\.eligible_orders/)
  assert.match(migration, /lower\(customer\.email\)/)
  assert.match(accountMigration, /delete from auth\.users/)
  assert.match(migration, /grant execute on function public\.get_user_deletion_document_paths\(uuid\) to service_role/)
  assert.match(migration, /Storage API before account deletion/)
  assert.match(endpoint, /authenticatePortalUser/)
  assert.match(endpoint, /profile\.email[\s\S]*headAdministratorEmail/)
  assert.match(endpoint, /\.from\('refund-documents'\)[\s\S]*\.remove/)
  assert.match(endpoint, /userClient\.rpc\('delete_user_account'/)
  assert.match(app, /fetch\('\/api\/delete-user'/)
  assert.match(app, /modal-inline-error/)
})

test('verified customers can submit requests while staff control refund amounts', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const migration = readFileSync(
    new URL('../supabase/migrations/20260716120000_customer_full_refund_form.sql', import.meta.url),
    'utf8',
  )

  assert.match(app, /async function handleSignUp/)
  assert.match(app, /Create customer account/)
  assert.match(app, /emailRedirectTo: `\$\{window\.location\.origin\}\/login`/)
  assert.match(app, /submit_customer_refund_request_details/)
  assert.match(app, /verify_customer_refund_order/)
  assert.match(migration, /customer_user\.role <> 'customer'/)
  assert.match(migration, /customer_user\.email_confirmed_at is null/)
  assert.match(migration, /'Pending staff verification'/)
  assert.match(migration, /amount_requested,[\s\S]*customer_requested_amount/)
  assert.match(migration, /null,[\s\S]*0,[\s\S]*trim\(p_refund_reason\)/)
  assert.match(migration, /revoke execute on function public\.submit_customer_refund_request/)
  assert.match(migration, /refund-submit:/)
})

test('customer form records a requested amount without controlling the verified payout', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const migration = readFileSync(
    new URL('../supabase/migrations/20260716120000_customer_full_refund_form.sql', import.meta.url),
    'utf8',
  )
  const customerForm = app.slice(
    app.indexOf('className="work-card guided-refund-form"'),
    app.indexOf("{activeView === 'manager'"),
  )

  assert.doesNotMatch(customerForm, /Government ID/i)
  assert.match(customerForm, /Amount requested/)
  assert.match(customerForm, /Subject to staff verification/)
  assert.match(customerForm, /Antivirus product/)
  assert.doesNotMatch(customerForm, /name="refundAmount"/)
  assert.match(migration, /customer_requested_amount/)
  assert.match(migration, /amount_requested,[\s\S]*customer_phone_submitted/)
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
