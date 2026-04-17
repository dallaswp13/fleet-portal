/**
 * PDF Assignment Parser
 * Extracts driver-vehicle assignment data from scanned NTS-67 report PDFs.
 *
 * Strategy:
 * 1. Render PDF pages to PNG using pdfjs-dist + @napi-rs/canvas (pure Node.js)
 * 2. Send images to Claude Vision (Haiku) for structured data extraction
 * 3. Parse JSON responses into assignment records
 *
 * Handles rotated scans — Claude Vision reads images in any orientation.
 * Uses Haiku for cost efficiency (~$0.03 for a 24-page report).
 * Works on Vercel serverless (no system dependencies required).
 */

import { createCanvas } from '@napi-rs/canvas'

interface AssignmentRow {
  driver_id: number
  vehicle_number: number
  fleet_id: string
}

interface ParseProgress {
  stage: string
  message: string
  pct: number
}

/**
 * Render PDF pages to PNG buffers using pdfjs-dist + @napi-rs/canvas.
 * Pure Node.js — no system tools (pdftoppm, ghostscript) required.
 * Renders at scale 2.0 (~200 DPI) for good OCR quality.
 */
async function renderPdfPages(pdfBuffer: ArrayBuffer): Promise<Buffer[]> {
  // pdfjs-dist is ESM-only; dynamic import of .mjs build for Node.js compat.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.mjs')

  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) }).promise
  const pages: Buffer[] = []

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const scale = 2.0 // ~200 DPI for letter-size pages
    const viewport = page.getViewport({ scale })

    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height))
    const ctx = canvas.getContext('2d')

    // pdfjs-dist render expects a canvas-like context
    // @napi-rs/canvas is compatible with the CanvasRenderingContext2D interface
    await page.render({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      canvasContext: ctx as any,
      viewport,
    }).promise

    const pngBuffer = canvas.toBuffer('image/png')
    pages.push(pngBuffer)

    page.cleanup()
  }

  await doc.destroy()
  return pages
}

const EXTRACTION_PROMPT = `Extract all data rows from this driver assignment table. The page may be rotated — read it in the correct orientation.

The table has columns: Driver ID, Last Name, First Name, Veh#, Fleet.

For each row, return ONLY these 3 fields:
- driver_id: the 5-digit driver ID number
- vehicle_number: the 3-4 digit vehicle number
- fleet_id: the single-letter fleet code (Y, U, E, L, S, C, G, D)

Return ONLY a JSON array of objects. No explanation, no markdown fences, no other text.
Example: [{"driver_id":19089,"vehicle_number":6650,"fleet_id":"Y"}]

If the image is blank, unreadable, or contains no data rows, return an empty array: []`

/**
 * Send page images to Claude Vision and extract assignment data.
 * Processes pages in parallel batches of 8 to stay within rate limits.
 */
async function ocrPagesWithVision(
  pages: Buffer[],
  apiKey: string,
  onProgress?: (p: ParseProgress) => void,
): Promise<AssignmentRow[]> {
  const BATCH_SIZE = 8
  const allRows: AssignmentRow[] = []

  for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    const batch = pages.slice(i, i + BATCH_SIZE)

    onProgress?.({
      stage: 'ocr',
      message: `Reading pages ${i + 1}–${Math.min(i + BATCH_SIZE, pages.length)} of ${pages.length}…`,
      pct: 15 + Math.round((i / pages.length) * 70),
    })

    // Process each page in the batch in parallel
    const results = await Promise.all(
      batch.map(async (pngBuf, j) => {
        const pageNum = i + j + 1
        const b64 = pngBuf.toString('base64')

        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 4096,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
                { type: 'text', text: EXTRACTION_PROMPT },
              ],
            }],
          }),
        })

        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`Claude API error on page ${pageNum}: ${res.status} — ${errText.slice(0, 200)}`)
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = await res.json()
        const text: string = data.content?.[0]?.text ?? ''

        // Extract JSON array from response
        const jsonMatch = text.match(/\[\s*(\{[\s\S]*\})?\s*\]/)
        if (!jsonMatch) return []

        try {
          const rows: AssignmentRow[] = JSON.parse(jsonMatch[0])
          return rows.filter(r =>
            typeof r.driver_id === 'number' && !isNaN(r.driver_id) &&
            typeof r.vehicle_number === 'number' && !isNaN(r.vehicle_number) &&
            typeof r.fleet_id === 'string' && r.fleet_id.length === 1
          )
        } catch {
          return []
        }
      })
    )

    for (const rows of results) {
      allRows.push(...rows)
    }
  }

  return allRows
}

/**
 * Main entry point: parse a PDF buffer into assignment records.
 */
export async function parseAssignmentPdf(
  pdfBuffer: ArrayBuffer,
  apiKey: string,
  onProgress?: (p: ParseProgress) => void,
): Promise<{ records: Record<string, unknown>[]; totalPages: number }> {
  onProgress?.({ stage: 'rendering', message: 'Rendering PDF pages…', pct: 5 })

  const pages = await renderPdfPages(pdfBuffer)
  if (pages.length === 0) {
    throw new Error('No pages found in PDF. The file may be empty or corrupted.')
  }

  onProgress?.({ stage: 'ocr', message: `Processing ${pages.length} pages with Claude Vision…`, pct: 15 })

  const rows = await ocrPagesWithVision(pages, apiKey, onProgress)

  onProgress?.({ stage: 'dedup', message: 'Deduplicating records…', pct: 90 })

  // Deduplicate: same driver_id + vehicle_number + fleet_id
  const seen = new Map<string, AssignmentRow>()
  for (const r of rows) {
    const key = `${r.driver_id}|${r.vehicle_number}|${r.fleet_id}`
    if (!seen.has(key)) seen.set(key, r)
  }

  const now = new Date().toISOString()
  const records = Array.from(seen.values()).map(r => ({
    driver_id: r.driver_id,
    vehicle_number: r.vehicle_number,
    fleet_id: r.fleet_id,
    is_primary: true,
    updated_at: now,
  }))

  return { records, totalPages: pages.length }
}
