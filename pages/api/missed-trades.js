import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  // ── GET — list missed trades ──────────────────────────────────────────────
  if (req.method === 'GET') {
    const { from, to } = req.query
    let q = supabase.from('missed_trades').select('*').order('entry_time', { ascending: false })
    if (from) q = q.gte('entry_time', from)
    if (to)   q = q.lte('entry_time', to)
    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ missed_trades: data || [] })
  }

  // ── POST — create missed trade ────────────────────────────────────────────
  if (req.method === 'POST') {
    const {
      symbol, direction, entry_time, exit_time,
      entry_price, exit_price, position_size_usd,
      reason_missed, confidence_level, notes,
    } = req.body

    // Auto-calculate hypothetical P&L if prices + size provided
    let hypothetical_pnl_usd = null
    let hypothetical_pct     = null
    if (entry_price && exit_price && entry_price > 0 && position_size_usd) {
      const pct = direction === 'Long'
        ? (exit_price / entry_price - 1)
        : (entry_price / exit_price - 1)
      hypothetical_pct     = pct * 100
      hypothetical_pnl_usd = pct * position_size_usd
    }

    const { data, error } = await supabase
      .from('missed_trades')
      .insert([{
        symbol, direction, entry_time, exit_time,
        entry_price, exit_price, position_size_usd,
        hypothetical_pnl_usd, hypothetical_pct,
        reason_missed, confidence_level: confidence_level || null,
        notes, updated_at: new Date().toISOString(),
      }])
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ missed_trade: data })
  }

  // ── PATCH — update missed trade ───────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { id, ...fields } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })

    // Recalculate hypothetical P&L if prices changed
    const { entry_price, exit_price, direction, position_size_usd } = fields
    if (entry_price && exit_price && entry_price > 0 && position_size_usd) {
      const pct = direction === 'Long'
        ? (exit_price / entry_price - 1)
        : (entry_price / exit_price - 1)
      fields.hypothetical_pct     = pct * 100
      fields.hypothetical_pnl_usd = pct * position_size_usd
    }
    fields.updated_at = new Date().toISOString()

    const { data, error } = await supabase
      .from('missed_trades')
      .update(fields)
      .eq('id', id)
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ missed_trade: data })
  }

  // ── DELETE — delete missed trade ──────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id required' })

    // Also delete associated images from storage
    const { data: images } = await supabase
      .from('trade_images')
      .select('filename')
      .eq('entity_type', 'missed_trade')
      .eq('entity_id', id)

    if (images?.length) {
      const paths = images.map(img => `missed/${id}/${img.filename}`)
      await supabase.storage.from('trade-images').remove(paths)
      await supabase.from('trade_images').delete()
        .eq('entity_type', 'missed_trade').eq('entity_id', id)
    }

    const { error } = await supabase.from('missed_trades').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
