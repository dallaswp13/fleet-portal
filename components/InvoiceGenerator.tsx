'use client'
import { useState } from 'react'

interface LineItem { description: string; qty: number; unitPrice: number; total: number }
interface A7Credits { owed: number; purchased: number; entity: string; credited: number }
interface InvoiceData {
  invoiceId: string; fleet: string; monthLabel: string
  from: string[]; invoiceToName: string; billTo: string[]
  project: string; lineItems: LineItem[]
  notes: string[]; subtotal: number
  a7Credits: A7Credits | null
}

const FLEET_OPTIONS = [
  { value: 'C', label: 'C — California Yellow Cab (CYC)' },
  { value: 'D', label: 'D — Metro Capital Group (Denver)' },
  { value: 'G', label: 'G — San Diego Yellow Cab (SDY)' },
]

const DEFAULT_UNIT_PRICE = 3.32

export default function InvoiceGenerator() {
  const [fleet,          setFleet]          = useState('C')
  const [qty,            setQty]            = useState('')
  const [unitPrice,      setUnitPrice]      = useState(String(DEFAULT_UNIT_PRICE))
  const [tabletCredits,  setTabletCredits]  = useState('')
  const [extraNotes,     setExtraNotes]     = useState('')
  const [loading,        setLoading]        = useState(false)
  const [invoice,        setInvoice]        = useState<InvoiceData | null>(null)
  const [error,          setError]          = useState<string | null>(null)

  const total = (parseFloat(qty) || 0) * (parseFloat(unitPrice) || 0)

  async function generate() {
    setLoading(true); setError(null); setInvoice(null)
    try {
      const res = await fetch('/api/invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fleet, qty: parseInt(qty), unitPrice: parseFloat(unitPrice),
          tabletCredits: tabletCredits ? parseInt(tabletCredits) : undefined,
          notes: extraNotes || undefined,
        })
      })
      const data = await res.json()
      if (data.success) setInvoice(data.invoice)
      else setError(data.error ?? 'Failed to generate invoice')
    } catch { setError('Network error') }
    setLoading(false)
  }

  function printInvoice() {
    if (!invoice) return
    const html = buildInvoiceHTML(invoice)
    const win  = window.open('', '_blank')
    if (!win) return
    win.document.write(html)
    win.document.close()
    win.focus()
    setTimeout(() => win.print(), 500)
  }

  function buildInvoiceHTML(inv: InvoiceData): string {
    const total = inv.subtotal
    const fmt   = (n: number) => `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`

    const notesHtml = inv.notes.length
      ? `<div class="notes"><strong>Notes:</strong> ${inv.notes.join('<br>')}</div>`
      : ''

    const a7Html = inv.a7Credits ? `
      <div class="a7-note">
        <strong>A7 Credits Note:</strong><br>
        # of A7 tablets still owed to ${inv.a7Credits.entity}: ${inv.a7Credits.owed} A7 Tablets<br>
        ${inv.a7Credits.entity} originally purchased ${inv.a7Credits.purchased} A7 tablets from Verizon.
        ${inv.a7Credits.credited > 0 ? `<br>${inv.a7Credits.credited} tablets credited this invoice.` : ''}
      </div>` : ''

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice ${inv.invoiceId}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #000; padding: 40px; max-width: 700px; margin: 0 auto; }
    h1 { font-size: 28px; font-weight: bold; text-align: right; margin-bottom: 24px; }
    .header { display: flex; justify-content: space-between; margin-bottom: 28px; }
    .from { font-size: 12px; line-height: 1.6; }
    .invoice-meta { text-align: right; }
    .invoice-meta table { margin-left: auto; border-collapse: collapse; }
    .invoice-meta td { padding: 3px 8px; font-size: 12px; }
    .invoice-meta td:first-child { font-weight: bold; }
    .parties { display: flex; justify-content: space-between; margin-bottom: 24px; padding: 14px; border: 1px solid #ccc; }
    .parties-col { font-size: 12px; line-height: 1.7; }
    .parties-col .label { font-size: 10px; font-weight: bold; text-transform: uppercase; color: #666; margin-bottom: 2px; }
    table.items { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    table.items th { background: #222; color: #fff; padding: 8px 12px; text-align: left; font-size: 12px; }
    table.items th:last-child, table.items td:last-child { text-align: right; }
    table.items td { padding: 10px 12px; border-bottom: 1px solid #eee; font-size: 12px; }
    .totals { display: flex; justify-content: flex-end; }
    .totals table { border-collapse: collapse; min-width: 200px; }
    .totals td { padding: 6px 12px; font-size: 13px; }
    .totals .total-row td { font-weight: bold; font-size: 14px; border-top: 2px solid #000; }
    .notes { margin-top: 20px; font-size: 12px; padding: 12px; background: #f9f9f9; border: 1px solid #eee; }
    .a7-note { margin-top: 16px; font-size: 12px; line-height: 1.7; padding: 12px; border: 1px solid #ddd; background: #fffbf0; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <h1>Invoice</h1>
  <div class="header">
    <div class="from">${inv.from.join('<br>')}</div>
    <div class="invoice-meta">
      <table>
        <tr><td>Invoice ID</td><td>${inv.invoiceId}</td></tr>
        <tr><td>Project</td><td>${inv.project}</td></tr>
      </table>
    </div>
  </div>

  <div class="parties">
    <div class="parties-col">
      <div class="label">Invoice for</div>
      ${inv.invoiceToName}
    </div>
    <div class="parties-col">
      <div class="label">Payable to</div>
      Administrative Services Co-op
    </div>
    <div class="parties-col">
      <div class="label">Bill to</div>
      ${inv.billTo.join('<br>')}
    </div>
  </div>

  <table class="items">
    <thead>
      <tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Total Price</th></tr>
    </thead>
    <tbody>
      ${inv.lineItems.map(l => `
        <tr>
          <td>${l.description}</td>
          <td>${l.qty}</td>
          <td>${fmt(l.unitPrice)}</td>
          <td>${fmt(l.total)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="totals">
    <table>
      <tr><td>Subtotal</td><td>${fmt(total)}</td></tr>
      <tr class="total-row"><td>Total</td><td>${fmt(total)}</td></tr>
    </table>
  </div>

  ${notesHtml}
  ${a7Html}
</body>
</html>`
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>
        Generate monthly MaaS360 license invoices. Fill in the fields below and download the PDF.
      </p>

      {/* Form */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="form-group">
          <label className="form-label">Fleet *</label>
          <select value={fleet} onChange={e => { setFleet(e.target.value); setInvoice(null) }}>
            {FLEET_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="form-hint">Determines template, billing contact, and A7 credits</div>
        </div>

        <div className="form-group">
          <label className="form-label">Active Devices (Qty) *</label>
          <input type="number" min="0" placeholder="e.g. 218" value={qty}
            onChange={e => { setQty(e.target.value); setInvoice(null) }} />
          <div className="form-hint">Number of active MaaS360 licenses</div>
        </div>

        <div className="form-group">
          <label className="form-label">Unit Price ($/device) *</label>
          <input type="number" step="0.01" min="0" placeholder="3.32" value={unitPrice}
            onChange={e => { setUnitPrice(e.target.value); setInvoice(null) }} />
          <div className="form-hint">Cost per MaaS360 license</div>
        </div>

        <div className="form-group">
          <label className="form-label">Tablet Credits Used</label>
          <input type="number" min="0" placeholder="e.g. 10" value={tabletCredits}
            onChange={e => { setTabletCredits(e.target.value); setInvoice(null) }} />
          <div className="form-hint">Deducted from A7 balance (C and G fleets only)</div>
        </div>
      </div>

      <div className="form-group" style={{ marginBottom: 20 }}>
        <label className="form-label">Additional Notes</label>
        <input placeholder="e.g. -100 tablets given to Matt Rouse" value={extraNotes}
          onChange={e => { setExtraNotes(e.target.value); setInvoice(null) }} />
        <div className="form-hint">Appears in the Notes section of the invoice</div>
      </div>

      {/* Live total preview */}
      {qty && unitPrice && (
        <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: 'var(--text2)' }}>{qty} devices × ${parseFloat(unitPrice).toFixed(2)}</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>
            ${total.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
          </span>
        </div>
      )}

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn-primary" onClick={generate}
          disabled={loading || !qty || !unitPrice || !fleet}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {loading ? <><span className="spinner" /> Generating…</> : '🧾 Generate Invoice'}
        </button>
        {invoice && (
          <button className="btn-secondary" onClick={printInvoice}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
              <rect x="6" y="14" width="12" height="8"/>
            </svg>
            Print / Save PDF
          </button>
        )}
      </div>

      {/* Invoice preview */}
      {invoice && (
        <div style={{ marginTop: 24, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px 24px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
            Invoice Preview — {invoice.invoiceId}
          </div>

          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 16 }}>
            <div style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--text2)' }}>
              {invoice.from.map((l, i) => <div key={i}>{l}</div>)}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>Invoice</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>ID: <strong style={{ color: 'var(--text)' }}>{invoice.invoiceId}</strong></div>
            </div>
          </div>

          {/* Parties */}
          <div style={{ display: 'flex', gap: 20, marginBottom: 16, padding: '10px 14px', background: 'var(--bg2)', borderRadius: 'var(--radius)', flexWrap: 'wrap' }}>
            {[
              { label: 'Invoice for', value: invoice.invoiceToName },
              { label: 'Payable to', value: 'Administrative Services Co-op' },
              { label: 'Bill to', value: invoice.billTo.join(', ') },
            ].map(p => (
              <div key={p.label} style={{ flex: '1 1 150px' }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{p.label}</div>
                <div style={{ fontSize: 12 }}>{p.value}</div>
              </div>
            ))}
          </div>

          {/* Line items */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg4)' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 11 }}>Description</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, fontSize: 11 }}>Qty</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, fontSize: 11 }}>Unit Price</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, fontSize: 11 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((l, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px' }}>{l.description}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{l.qty}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>${l.unitPrice.toFixed(2)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>${l.total.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Subtotal */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <div style={{ minWidth: 200, padding: '8px 12px', background: 'var(--bg2)', borderRadius: 'var(--radius)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span>Subtotal</span><span>${invoice.subtotal.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
                <span>Total</span><span style={{ color: 'var(--accent)' }}>${invoice.subtotal.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</span>
              </div>
            </div>
          </div>

          {/* Notes + A7 credits */}
          {invoice.notes.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text2)', padding: '10px 12px', background: 'var(--bg2)', borderRadius: 'var(--radius)', marginBottom: 10 }}>
              <strong>Notes:</strong> {invoice.notes.join(' · ')}
            </div>
          )}
          {invoice.a7Credits && (
            <div style={{ fontSize: 12, color: 'var(--amber)', padding: '10px 12px', background: 'var(--amber-bg)', borderRadius: 'var(--radius)', border: '1px solid rgba(243,156,18,0.3)' }}>
              <strong>A7 Credits:</strong> {invoice.a7Credits.owed} tablets still owed to {invoice.a7Credits.entity} ·{' '}
              {invoice.a7Credits.entity} originally purchased {invoice.a7Credits.purchased} A7 tablets from Verizon
              {invoice.a7Credits.credited > 0 && ` · ${invoice.a7Credits.credited} credited this invoice`}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
