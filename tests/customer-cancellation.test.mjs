import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migration = await readFile(
  new URL('../supabase/migrations/20260715033000_customer_refund_cancellation.sql', import.meta.url),
  'utf8',
)
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('customer cancellation is owner-only, submitted-only, and confirmed', () => {
  assert.match(migration, /current_user_role\(\) <> 'customer'/)
  assert.match(migration, /request\.created_by = actor_id/)
  assert.match(migration, /owned_request\.status <> 'submitted'/)
  assert.match(migration, /p_confirmation <> 'Cancel refund request'/)
})

test('customer cancellation removes request data and orphan customer records after secure storage cleanup', () => {
  assert.match(migration, /Uploaded documents must be removed before cancellation/)
  assert.match(migration, /customers can remove own submitted refund documents/)
  assert.match(migration, /delete from public\.audit_logs/)
  assert.match(migration, /delete from public\.refund_requests/)
  assert.match(migration, /delete from public\.customers/)
  assert.match(migration, /not exists/)
})

test('customer cancellation leaves only a generic immutable audit event', () => {
  assert.match(migration, /'refund_request_cancelled'/)
  assert.match(migration, /'refund_request',\s*null/)
  assert.match(migration, /'recordRemoved', true/)
})

test('customer UI requires typed confirmation and calls the protected RPC', () => {
  assert.match(app, /cancelConfirmationText !== 'Cancel refund request'/)
  assert.match(app, /supabase\.rpc\('cancel_refund_request'/)
  assert.match(app, /\.from\('refund-documents'\)\s*\.remove\(documentPaths\)/)
  assert.match(app, /request\.status === 'submitted'/)
})
