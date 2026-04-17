/**
 * PDF Assignment Parser
 * Extracts driver-vehicle assignment data from scanned NTS-67 report PDFs.
 *
 * Strategy:
 * 1. Render PDF pages to high-res PNG using pdftoppm (poppler) or Ghostscript
 * 2. Send images to Claude Vision (Haiku) for structured data extraction
 * 3. Parse JSON responses into assignment records
 *
 * Handles rotated scans — Claude Vision reads images in any orientation.
 * Uses Haiku for cost efficiency (~$0.03 for a 24-page report).
 */

import { execSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync, rmdirSync } from 'fs'
import { join } from 'path'

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
 * Render PDF pages to PNG images using pdftoppm (preferred) or Ghostscript.
 * Returns an array of PNG buffers, one per page.
 */
function renderPdfPages(pdfBuffer: ArrayBuffer): Buffer[] {
  const tmpDir = join('/tmp', `pdf_import_${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })
  const pdfPath = join(tmpDir, 'input.pdf')
  writeFileSync(pdfPath, Buffer.from(pdfBuffer))

  try {
    // Try pdftoppm first (poppler-utils) — best quality
    try {
      execSync(`which pdftoppm`, { stdio: 'ignore' })
      execSync(
        `pdftoppm -r 200 -png ${JSON.stringify(pdfPath)} ${join(tmpDir, 'page')}`,
        { timeout: 60000, stdio: 'ignore' },
      )
    } catch {
      // Fallback to Ghostscript
      try {
        execSync(`which gs`, { stdio: 'ignore' })
        execSync(
          `gs -dNOPAUSE -dBATCH -sDEVICE=png16m -r200 -sOutputFile=${join(tmpDir, 'page-%02d.png')} ${JSON.stringify(pdfPath)}`,
          { timeout: 60000, stdio: 'ignore' },
        )
      } catch {
        throw new Error(
          'PDF rendering requires pdftoppm (poppler-utils) or Ghostscript. ' +
          'Neither is available on this server. Please convert the PDF to CSV or XLSX and re-upload.',
        )
      }
    }

    // Read all rendered page images
    const pageFiles = readdirSync(tmpDir)
      .filter(f => f.startsWith('page') && f.endsWith('.png'))
      .sort()

    return pageFiles.map(f => readFileSync(join(tmpDir, f)))
  } finally {
    // Cleanup temp files
    try {
      readdirSync(tmpDir).forEach(f => unlinkSync(join(tmpDir, f)))
      rmdirSync(tmpDir)
    } catch { /* best-effort cleanup */ }
  }
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

  const pages = renderPdfPages(pdfBuffer)
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
