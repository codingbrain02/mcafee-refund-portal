import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('../supabase/migrations/20260715030000_enforce_refund_workflow.sql', import.meta.url),
  'utf8',
)

test('database enforces the ordered refund workflow', () => {
  assert.match(migration, /old\.status = 'submitted' and new\.status = 'under_review'/)
  assert.match(migration, /old\.status = 'under_review' and new\.status in \('documents_verified', 'rejected'\)/)
  assert.match(migration, /old\.status = 'documents_verified' and new\.status in \('approved', 'rejected'\)/)
  assert.match(migration, /old\.status = 'approved' and new\.status = 'payment_processing'/)
  assert.match(migration, /old\.status = 'payment_processing' and new\.status = 'credited'/)
  assert.match(migration, /assigned to another handler/)
})

test('workflow trigger rejects repeated status writes', () => {
  assert.match(migration, /Refund status % has already been recorded/)
})
