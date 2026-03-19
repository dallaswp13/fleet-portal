import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Invoice template data per fleet
const FLEET_TEMPLATES: Record<string, {
  billTo: string[]
  invoiceToName: string
  a7Owed?: number
  a7Purchased?: number
  a7Entity?: string
}> = {
  C: {
    invoiceToName: 'Akbar Majid',
    billTo: ['California Yellow Cab', '520 W. Dyer Road', 'Santa Ana, CA 92707'],
    a7Owed: 126,
    a7Purchased: 542,
    a7Entity: 'CYC',
  },
  D: {
    invoiceToName: 'Sean Cifuentes',
    billTo: ['Metro Capital Group, LLC', '2174 S. Valentia St.', 'Denver, CO 80231'],
  },
  G: {
    invoiceToName: 'Akbar Majid',
    billTo: ['San Diego Yellow Cab', '3473 Kurtz St', 'San Diego, CA 92110'],
    a7Owed: 149,
    a7Purchased: 434,
    a7Entity: 'SDY',
  },
}

const FROM_ADDRESS = [
  'ASC Tech Department',
  '2050 W. 190th St. Suite #100',
  'Torrance, CA 90504',
  '(310) 715-1986',
]

function formatCurrency(n: number): string {
  return `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

function getMonthLabel(): string {
  const now = new Date()
  const m   = now.toLocaleString('default', { month: '2-digit' })
  const y   = String(now.getFullYear()).slice(2)
  return `${m}-${y}`
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { fleet, qty, unitPrice, tabletCredits, notes } = body as {
    fleet: string
    qty: number
    unitPrice: number
    tabletCredits?: number
    notes?: string
  }

  if (!fleet || !qty || !unitPrice) {
    return NextResponse.json({ error: 'fleet, qty, and unitPrice are required' }, { status: 400 })
  }

  const template = FLEET_TEMPLATES[fleet.toUpperCase()]
  if (!template) {
    return NextResponse.json({ error: `Unknown fleet: ${fleet}. Must be C, D, or G.` }, { status: 400 })
  }

  const total      = qty * unitPrice
  const monthLabel = getMonthLabel()
  const invoiceId  = `${fleet.toUpperCase()}-${monthLabel}`

  // Build PDF using HTML-like structure rendered as a fetch to our own PDF endpoint
  // We return JSON with all the data; the client renders it via a browser-printable page
  // OR we can use a server-side PDF generator

  // For Vercel edge compatibility, we'll return structured data and let the client
  // generate a print-ready HTML page that matches the invoice format exactly
  const creditNote = tabletCredits && template.a7Owed != null
    ? `${tabletCredits} tablets credited toward balance`
    : null

  const newA7Owed = tabletCredits && template.a7Owed != null
    ? Math.max(0, template.a7Owed - tabletCredits)
    : template.a7Owed

  const invoiceData = {
    invoiceId,
    fleet: fleet.toUpperCase(),
    monthLabel,
    from: FROM_ADDRESS,
    invoiceToName: template.invoiceToName,
    billTo: template.billTo,
    project: 'MaaS360 monthly licenses + any new equipment',
    lineItems: [
      {
        description: 'MaaS360 (+Teamviewer) Active Licenses/Devices',
        qty,
        unitPrice,
        total,
      }
    ],
    notes: [
      ...(notes ? [notes] : []),
      ...(creditNote ? [creditNote] : []),
    ],
    subtotal: total,
    a7Credits: template.a7Owed != null ? {
      owed:      newA7Owed,
      purchased: template.a7Purchased,
      entity:    template.a7Entity,
      credited:  tabletCredits ?? 0,
    } : null,
  }

  return NextResponse.json({ success: true, invoice: invoiceData })
}
