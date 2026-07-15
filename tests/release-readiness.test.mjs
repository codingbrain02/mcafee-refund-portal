import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const requiredDocs = [
  '../docs/API.md',
  '../docs/DEPLOYMENT.md',
  '../docs/ADMIN_MANUAL.md',
  '../docs/TECHNICAL.md',
  '../docs/PRODUCTION_CHECKLIST.md',
]

test('release documentation is present and project-specific', () => {
  for (const path of requiredDocs) {
    const content = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(content, /Refund|Production|API|Administrator|Technical/i)
    assert.ok(content.length > 500, `${path} should contain operational detail`)
  }
})

test('environment template contains placeholders and no banking example endpoint', () => {
  const template = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
  assert.match(template, /SUPABASE_SERVICE_ROLE_KEY=server-only/)
  assert.match(template, /RESEND_API_KEY=server-only/)
  assert.match(template, /AUTHORIZED_BANK_API_BASE_URL=\r?\n/)
  assert.doesNotMatch(template, /bank-api\.example\.com/)
})

test('CI runs the complete quality gate', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  assert.match(workflow, /npm ci/)
  assert.match(workflow, /npm run check/)
})
