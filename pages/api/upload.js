// pages/api/upload.js
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { parseTradeFile } from '../../lib/tradeUtils'
import { computeStreaks } from '../../lib/parserUtils'

// Proper RFC 4180 CSV parser — handles quoted fields containing commas and newlines
function parseCSV(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i+1]
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++ }
      else if (ch === '"')            { inQuotes = false }
      else                            { field += ch }
    } else {
      if      (ch === '"')  { inQuotes = true }
      else if (ch === ',')  { row.push(field.trim()); field = '' }
      else if (ch === '\r' && next === '\n') { row.push(field.trim()); rows.push(row); row = []; field = ''; i++ }
      else if (ch === '\n') { row.push(field.trim()); rows.push(row); row = []; field = '' }
      else                  { field += ch }
    }
  }
  if (field || row.length) { row.push(field.trim()); rows.push(row) }
  return rows.filter(r => r.some(c => c !== ''))
}

export const config = { api: { bodyParser: false } }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const BROKER_COLORS  = ['#1a56db','#059669','#d97706','#7c3aed','#dc2626','#0891b2','#be185d','#16a34a']
const BROKER_LABELS  = {
  PrimeXBT:    id => `PrimeXBT ${id}`,
  IBKR:        id => `IBKR ${id}`,
  Extended:    id => `Extended 0x9507...6466`,
  Hyperliquid: id => `Hyperliquid ${id.slice(0,6)}....${id.slice(-4)}`,
}
const BROKER_DEFAULT_COLORS = {
  IBKR:        '#D92027',
  Extended:    '#23DCA1',
  Hyperliquid: '#97FCE4',
}

// Per-account colour overrides based on currency
const ACCOUNT_CURRENCY_COLORS = {
  PrimeXBT: { USDC: '#2775C9', USDT: '#009393' },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    // Read raw multipart body
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)

    const contentType   = req.headers['content-type'] || ''
    const boundaryMatch = contentType.match(/boundary=(.+)$/)
    if (!boundaryMatch) return res.status(400).json({ error: 'No boundary in content-type' })

    // Simple multipart parser
    const boundary = '--' + boundaryMatch[1]
    const parts    = buffer.toString('binary').split(boundary)
    let fileBuffer    = null
    let filename      = 'upload.csv'
    let formAccountId = null

    for (const part of parts) {
      if (part.includes('filename=')) {
        const fnMatch = part.match(/filename="([^"]+)"/)
        if (fnMatch) filename = fnMatch[1]
        const headerEnd = part.indexOf('\r\n\r\n')
        if (headerEnd >= 0) {
          const body = part.slice(headerEnd + 4, part.lastIndexOf('\r\n'))
          fileBuffer = Buffer.from(body, 'binary')
        }
      } else if (part.includes('name="accountId"')) {
        const headerEnd = part.indexOf('\r\n\r\n')
        if (headerEnd >= 0) {
          formAccountId = part.slice(headerEnd + 4, part.lastIndexOf('\r\n')).trim()
        }
      }
    }
    if (!fileBuffer) return res.status(400).json({ error: 'No file found in request' })

    // Parse into rows
    let rows
    if (filename.toLowerCase().endsWith('.csv')) {
      // Parse CSV with proper quoted field support
      const text = fileBuffer.toString('utf8').replace(/^\uFEFF/, '') // strip BOM
      rows = parseCSV(text)
    } else {
      const wb = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
    }

    // Detect broker + parse trades
    const accountIdOverride = req.headers['x-account-id'] || formAccountId || null
    const parsed = parseTradeFile(rows, filename, accountIdOverride)
    const { broker, accountId, currency, trades: incoming } = parsed

    if (!incoming.length) {
      return res.status(400).json({
        error: 'No valid trades found. Check the file format matches your broker export.'
      })
    }

    // Upsert account
    const { data: existingAccts } = await supabase.from('accounts').select('id').eq('id', accountId)
    if (!existingAccts?.length) {
      const { count } = await supabase.from('accounts').select('*', { count: 'exact', head: true })
      const colorIdx  = (count || 0) % BROKER_COLORS.length
      const color     = ACCOUNT_CURRENCY_COLORS[broker]?.[currency]
                     || BROKER_DEFAULT_COLORS[broker]
                     || BROKER_COLORS[colorIdx]
      const labelFn   = BROKER_LABELS[broker] || (id => id)
      await supabase.from('accounts').insert({
        id:       accountId,
        broker,
        label:    labelFn(accountId),
        currency,
        color,
      })
    }

    // Fetch existing position IDs for deduplication
    const { data: existing } = await supabase
      .from('trades').select('position_id').eq('account_id', accountId)
    const existingIds = new Set((existing || []).map(t => t.position_id))

    const newTrades = incoming.filter(t => !existingIds.has(t.position_id))
    const dupCount  = incoming.length - newTrades.length

    if (!newTrades.length) {
      return res.status(200).json({
        message:    'All trades already imported — no duplicates added',
        imported:   0,
        duplicates: dupCount,
        total:      incoming.length,
        broker,
        accountId,
      })
    }

    // Compute streaks across all trades (existing + new), sorted by entry_time
    const { data: allExisting } = await supabase
      .from('trades')
      .select('position_id, pnl, entry_time')
      .eq('account_id', accountId)
      .order('entry_time', { ascending: true })

    const combined = [
      ...(allExisting || []),
      ...newTrades.map(t => ({ position_id: t.position_id, pnl: t.pnl, entry_time: t.entry_time }))
    ].sort((a, b) => {
      const ta = a.entry_time || a.exit_time || ''
      const tb = b.entry_time || b.exit_time || ''
      return ta.localeCompare(tb)
    })

    const withStreaks   = computeStreaks(combined)
    const streakMap     = Object.fromEntries(withStreaks.map(t => [t.position_id, t.streak_id]))
    const tradesToInsert = newTrades.map(t => ({ ...t, streak_id: streakMap[t.position_id] || null }))

    // Insert in batches of 500
    let inserted = 0
    for (let i = 0; i < tradesToInsert.length; i += 500) {
      const batch        = tradesToInsert.slice(i, i + 500)
      const { error }    = await supabase.from('trades').insert(batch)
      if (error) throw new Error(`DB insert error: ${error.message}`)
      inserted += batch.length
    }

    return res.status(200).json({
      message:    `Imported ${inserted} new trades for account ${accountId}`,
      imported:   inserted,
      duplicates: dupCount,
      total:      incoming.length,
      broker,
      accountId,
      currency,
    })
  } catch (err) {
    console.error('Upload error:', err)
    return res.status(500).json({ error: err.message || 'Upload failed' })
  }
}
