// pages/api/upload.js
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { parseTradeFile } from '../../lib/tradeUtils'
import { parseHypurrscan, isHypurrscan } from '../../lib/parsers/hypurrscan'
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

export const config = { api: { bodyParser: false, responseLimit: '20mb' } }
// Note: bodyParser:false with manual multipart parsing bypasses the 4MB default.
// responseLimit raised to handle large CSV uploads (Bybit spot ~7MB).

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const BROKER_COLORS  = ['#1a56db','#059669','#d97706','#7c3aed','#dc2626','#0891b2','#be185d','#16a34a']
const BROKER_LABELS  = {
  PrimeXBT:    id => `PrimeXBT ${id}`,
  IBKR:        id => `IBKR ${id}`,
  Extended:    id => `Extended 0x9507...6466`,
  Hyperliquid: id => id && id.length > 10 ? `Hyperliquid ${id.slice(0,6)}....${id.slice(-4)}` : `Hyperliquid ${id || 'unknown'}`,
  Bybit:       id => id.includes('SPOT') ? 'Bybit Spot' : `Bybit ${id}`,
}
const BROKER_DEFAULT_COLORS = {
  IBKR:        '#D92027',
  Extended:    '#23DCA1',
  Hyperliquid: '#97FCE4',
  Bybit:       '#F7A600',
}
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
    const boundary    = '--' + boundaryMatch[1]
    const parts       = buffer.toString('binary').split(boundary)
    let fileBuffer    = null
    let filename      = 'upload.csv'
    let formAccountId = null
    let formTimezone  = 'Asia/Dubai'

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
        if (headerEnd >= 0) formAccountId = part.slice(headerEnd + 4, part.lastIndexOf('\r\n')).trim()
      } else if (part.includes('name="timezone"')) {
        const headerEnd = part.indexOf('\r\n\r\n')
        if (headerEnd >= 0) formTimezone = part.slice(headerEnd + 4, part.lastIndexOf('\r\n')).trim() || 'Asia/Dubai'
      }
    }
    if (!fileBuffer) return res.status(400).json({ error: 'No file found in request' })

    // Parse into rows
    let rows
    if (filename.toLowerCase().endsWith('.csv')) {
      const text = fileBuffer.toString('utf8').replace(/^\uFEFF/, '') // strip BOM
      rows = parseCSV(text)
    } else {
      const wb = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
    }

    const accountIdOverride = req.headers['x-account-id'] || formAccountId || null

    // ── Hypurrscan detection — handle separately (upsert mode) ─────────────
    if (isHypurrscan(rows)) {
      return await handleHypurrscan(rows, filename, accountIdOverride, res)
    }

    // ── Standard broker detection + insert ─────────────────────────────────
    const parsed = parseTradeFile(rows, filename, accountIdOverride, formTimezone)
    const { broker, accountId, currency, trades: incoming } = parsed

    if (!incoming.length) {
      return res.status(400).json({
        error: 'No valid trades found. Check the file format matches your broker export.'
      })
    }

    // Upsert account
    const { data: existingAccts } = await supabase.from('accounts').select('id').eq('id', accountId)
    if (!existingAccts?.length) {
      const { count }  = await supabase.from('accounts').select('*', { count: 'exact', head: true })
      const colorIdx   = (count || 0) % BROKER_COLORS.length
      const color      = ACCOUNT_CURRENCY_COLORS[broker]?.[currency]
                      || BROKER_DEFAULT_COLORS[broker]
                      || BROKER_COLORS[colorIdx]
      const labelFn    = BROKER_LABELS[broker] || (id => id)
      await supabase.from('accounts').insert({ id: accountId, broker, label: labelFn(accountId), currency, color })
    }

    // Deduplicate by position_id
    const { data: existing } = await supabase.from('trades').select('position_id').eq('account_id', accountId)
    const existingIds = new Set((existing || []).map(t => t.position_id))
    const newTrades   = incoming.filter(t => !existingIds.has(t.position_id))
    const dupCount    = incoming.length - newTrades.length

    if (!newTrades.length) {
      return res.status(200).json({
        message: 'All trades already imported — no duplicates added',
        imported: 0, duplicates: dupCount, total: incoming.length, broker, accountId,
      })
    }

    // Compute streaks
    const { data: allExisting } = await supabase
      .from('trades').select('position_id, pnl, entry_time').eq('account_id', accountId)
      .order('entry_time', { ascending: true })

    const combined = [
      ...(allExisting || []),
      ...newTrades.map(t => ({ position_id: t.position_id, pnl: t.pnl, entry_time: t.entry_time }))
    ].sort((a, b) => (a.entry_time || '').localeCompare(b.entry_time || ''))

    const withStreaks    = computeStreaks(combined)
    const streakMap     = Object.fromEntries(withStreaks.map(t => [t.position_id, t.streak_id]))
    const tradesToInsert = newTrades.map(t => ({ ...t, streak_id: streakMap[t.position_id] || null }))

    // Upsert in batches of 500 — ignoreDuplicates so chunked uploads and
    // re-uploads never throw on existing position_ids
    let inserted = 0
    for (let i = 0; i < tradesToInsert.length; i += 500) {
      const batch     = tradesToInsert.slice(i, i + 500)
      const { error } = await supabase
        .from('trades')
        .upsert(batch, { onConflict: 'account_id,position_id', ignoreDuplicates: true })
      if (error) throw new Error(`DB insert error: ${error.message}`)
      inserted += batch.length
    }

    return res.status(200).json({
      message: `Imported ${inserted} new trades for account ${accountId}`,
      imported: inserted, duplicates: dupCount, total: incoming.length, broker, accountId, currency,
    })

  } catch (err) {
    console.error('Upload error:', err)
    return res.status(500).json({ error: err.message || 'Upload failed' })
  }
}

// ── Hypurrscan upload handler ────────────────────────────────────────────────
// Hypurrscan is the preferred Hyperliquid source:
//   - UTC timestamps (no timezone conversion needed)
//   - Captures TWAP trades missing from native CSV
//   - PnL calculated from entry/exit prices
//
// Behaviour:
//   - Matches parsed trades to existing trades by account_id + symbol + exit_time (±5s)
//   - UPDATES: enriches entry_time, entry_price, exit_price, size, duration, order_type
//   - INSERTS: new trades not found (e.g. TWAP trades)
//   - PnL for inserts: (exit_px - entry_px) / entry_px * notional * direction, minus fees

async function handleHypurrscan(rows, filename, accountIdOverride, res) {
  const parsed = parseHypurrscan(rows, filename, accountIdOverride)
  const { broker, accountId, currency, trades } = parsed

  if (!trades.length) {
    return res.status(400).json({ error: 'No valid trades found in Hypurrscan file.' })
  }

  // Ensure account exists
  const { data: existingAccts } = await supabase.from('accounts').select('id').eq('id', accountId)
  if (!existingAccts?.length) {
    const { count } = await supabase.from('accounts').select('*', { count: 'exact', head: true })
    const colorIdx  = (count || 0) % BROKER_COLORS.length
    await supabase.from('accounts').insert({
      id:       accountId,
      broker,
      label:    BROKER_LABELS[broker]?.(accountId) || accountId,
      currency,
      color:    BROKER_DEFAULT_COLORS[broker] || BROKER_COLORS[colorIdx],
    })
  }

  let updated = 0, inserted = 0, skipped = 0

  for (const trade of trades) {
    const key      = trade._upsert_key
    const exitMs   = new Date(key.exit_time).getTime()
    const exitFrom = new Date(exitMs - 5000).toISOString()
    const exitTo   = new Date(exitMs + 5000).toISOString()

    // Find existing trade to enrich
    const { data: existing } = await supabase
      .from('trades')
      .select('id, pnl, entry_time, entry_price')
      .eq('account_id', key.account_id)
      .eq('symbol', key.symbol)
      .gte('exit_time', exitFrom)
      .lte('exit_time', exitTo)
      .limit(1)

    // Build update payload — only send non-null fields from Hypurrscan
    const updatePayload = {}
    if (trade.entry_time  != null) updatePayload.entry_time   = trade.entry_time
    if (trade.entry_price != null) updatePayload.entry_price  = trade.entry_price
    if (trade.exit_price  != null) updatePayload.exit_price   = trade.exit_price
    if (trade.size        != null) updatePayload.size         = trade.size
    if (trade.duration_mins != null) updatePayload.duration_mins = trade.duration_mins
    if (trade.order_type  != null) updatePayload.order_type   = trade.order_type
    // Also update exit_time to the precise UTC value from Hypurrscan
    updatePayload.exit_time = trade.exit_time

    if (existing?.length > 0) {
      const row = existing[0]
      await supabase.from('trades').update(updatePayload).eq('id', row.id)
      updated++
    } else {
      // Trade not found — insert as new (e.g. TWAP trade missing from native CSV)
      // Calculate PnL from prices since Hypurrscan doesn't provide closedPnl
      let pnl = null
      if (trade.entry_price && trade.exit_price && trade.size) {
        const priceDiff = trade.direction === 'Long'
          ? trade.exit_price - trade.entry_price
          : trade.entry_price - trade.exit_price
        // Approximate notional from size * entry_price
        const notional = trade.notional_usd || (trade.size * trade.entry_price)
        const grossPnl = priceDiff * trade.size
        pnl = Math.round((grossPnl - (trade.fee || 0)) * 100) / 100
      }

      // Check for duplicate position_id
      const { data: dupCheck } = await supabase
        .from('trades').select('id').eq('position_id', trade.position_id).limit(1)
      if (dupCheck?.length) { skipped++; continue }

      const { _upsert_key, ...insertTrade } = { ...trade, pnl }
      const { error } = await supabase.from('trades').insert(insertTrade)
      if (error) {
        console.error('Hypurrscan insert error:', error.message)
        skipped++
      } else {
        inserted++
      }
    }
  }

  const parts = []
  if (updated)  parts.push(`${updated} trades enriched with entry data`)
  if (inserted) parts.push(`${inserted} new trades added (incl. TWAP)`)
  if (skipped)  parts.push(`${skipped} skipped`)

  return res.status(200).json({
    message:  parts.join(', ') || 'No changes made',
    imported: updated + inserted,
    updated,
    inserted,
    skipped,
    broker:   'Hyperliquid (Hypurrscan)',
    accountId,
  })
}
