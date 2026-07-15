import assert from 'node:assert/strict'
import test from 'node:test'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

test('PDF reporting dependencies generate a valid table document', () => {
  const document = new jsPDF({ format: 'a4', orientation: 'landscape', unit: 'pt' })
  document.text('Refund Management Portal Report', 40, 42)
  autoTable(document, {
    head: [['Reference', 'Customer', 'Amount', 'Status']],
    body: [['UAT-REPORT-1', 'Report Test Customer', '1.00', 'Submitted']],
    startY: 60,
  })

  const bytes = new Uint8Array(document.output('arraybuffer'))
  assert.ok(bytes.length > 1000)
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), '%PDF')
})
