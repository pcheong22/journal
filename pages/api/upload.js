import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { parseExcelRows } from '../../lib/tradeUtils'

export const config = { api: { bodyParser: false } }

// Server-side Supabase with service role (for writes)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    // Read raw body
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)

    // Parse boundary from content-type
    const contentType = req.headers['content-type'] || ''
    const boundaryMatch = contentType.match(/boundary=(.+)$/)
    if (!boundaryMatch) return res.status(400).json({ error: 'No boundary in content-type' })

    // Simple multipart parser
    const boundary = '--' + boundaryMatch[1]
    const parts = buffer.toString('binary').split(boundary)
    let fileBuffer = null

    for (const part of parts) {
      if (part.includes('filename=') && (part.includes('.xlsx') || part.includes('.xls') || part.includes('.csv'))) {
        const headerEnd = part.indexOf('\r\n\r\n')
        if (headerEnd >= 0) {
          const body = part.slice(headerEnd + 4, part.lastIndexOf('\r\n'))
          fileBuffer = Buffer.from(body, 'binary')
        }
      }
    }

    if (!fileBuffer) return res.status(400).json({ error: 'No file found in request' })

    // Parse workbook
    const wb = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })

    // Parse trades
    const incoming = parseExcelRows(rows)
    if (incoming.length === 0) {
      return res.status(400).json({ error: 'No valid trades found in file. Check file format.' })
    }

    // Fetch existing position IDs for deduplication
    const { data: existing } = await supabase
      .from('trades')
      .select('position_id')
    const existingIds = new Set((existing || []).map(t => t.position_id))

    // Filter to new trades only
    const newTrades = incoming.filter(t => !existingIds.has(t.position_id))
    const dupCount = incoming.length - newTrades.length

    if (newTrades.length === 0) {
      return res.status(200).json({
        message: 'No new trades to import',
        imported: 0,
        duplicates: dupCount,
        total: incoming.length,
      })
    }

    // Insert in batches of 500
    const batchSize = 500
    let inserted = 0
    for (let i = 0; i < newTrades.length; i += batchSize) {
      const batch = newTrades.slice(i, i + batchSize)
      const { error } = await supabase.from('trades').insert(batch)
      if (error) throw new Error(`DB insert error: ${error.message}`)
      inserted += batch.length
    }

    return res.status(200).json({
      message: `Successfully imported ${inserted} new trades`,
      imported: inserted,
      duplicates: dupCount,
      total: incoming.length,
    })
  } catch (err) {
    console.error('Upload error:', err)
    return res.status(500).json({ error: err.message || 'Upload failed' })
  }
}
