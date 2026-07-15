import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('reporting supports filtered CSV and PDF output', () => {
  assert.match(app, /type ReportFormat = 'csv' \| 'pdf'/)
  assert.match(app, /new jsPDF/)
  assert.match(app, /autoTable\(document/)
  assert.match(app, /statusFilter: reportStatusFilter/)
  assert.match(app, /productFilter: reportProductFilter/)
})

test('CSV export mitigates spreadsheet formula injection', () => {
  assert.match(app, /\/\^\[=\+\\-@\]\/\.test\(text\)/)
  assert.match(app, /text = `'\$\{text\}`/)
})

test('report export remains disabled without visible records', () => {
  assert.match(app, /disabled=\{filteredRequests\.length === 0 \|\| actionLoading === 'export'\}/)
})
