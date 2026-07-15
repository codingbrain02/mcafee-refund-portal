import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migration = await readFile(
  new URL('../supabase/migrations/20260715040000_hide_head_administrator.sql', import.meta.url),
  'utf8',
)
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('ordinary staff cannot select the head administrator account', () => {
  assert.match(migration, /not public\.is_head_portal_administrator\(id\)/)
  assert.match(migration, /public\.is_portal_administrator\(\)/)
  assert.match(migration, /employees can read staff display profiles/)
})

test('ordinary administrator audit results exclude head administrator activity', () => {
  assert.match(migration, /not public\.is_head_portal_administrator\(actor_id\)/)
  assert.match(migration, /metadata ->> 'actorEmail'/)
  assert.match(migration, /jccodingbrain@gmail\.com/)
})

test('frontend also removes the protected account for non-head sessions', () => {
  assert.match(app, /canSeeHeadAdministrator \|\| !isHeadAdministrator\(user\.email\)/)
  assert.match(app, /loadUsers\(profileToLoad\.email\)/)
})
