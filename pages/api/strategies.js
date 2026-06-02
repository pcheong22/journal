// pages/api/strategies.js
// CRUD for strategy groups + tagging trades

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  const { method, query, body } = req

  // ── GET /api/strategies ────────────────────────────────────────────────────
  // Returns all strategies with combined PnL summary
  if (method === 'GET' && !query.id) {
    const { data, error } = await supabase
      .from('strategy_summary')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data)
  }

  // ── GET /api/strategies?id=<uuid> ─────────────────────────────────────────
  // Returns one strategy with its full trade list
  if (method === 'GET' && query.id) {
    const [stratRes, tradesRes] = await Promise.all([
      supabase.from('strategy_summary').select('*').eq('id', query.id).single(),
      supabase.from('trades').select('*').eq('strategy_id', query.id).order('entry_time'),
    ])
    if (stratRes.error) return res.status(404).json({ error: 'Strategy not found' })
    return res.status(200).json({ strategy: stratRes.data, trades: tradesRes.data || [] })
  }

  // ── POST /api/strategies ───────────────────────────────────────────────────
  // Create a new strategy
  // Body: { name, type, description, trade_ids[] }
  if (method === 'POST') {
    const { name, type = 'delta_neutral', description, trade_ids = [] } = body
    if (!name) return res.status(400).json({ error: 'name is required' })

    // Create strategy
    const { data: strat, error: stratErr } = await supabase
      .from('strategies')
      .insert({ name, type, description })
      .select()
      .single()
    if (stratErr) return res.status(500).json({ error: stratErr.message })

    // Tag trades if provided
    if (trade_ids.length > 0) {
      const { error: tagErr } = await supabase
        .from('trades')
        .update({ strategy_id: strat.id })
        .in('id', trade_ids)
      if (tagErr) return res.status(500).json({ error: tagErr.message })
    }

    return res.status(201).json({ strategy: strat, tagged: trade_ids.length })
  }

  // ── PATCH /api/strategies?id=<uuid> ───────────────────────────────────────
  // Update strategy name/type/description, or add/remove trade tags
  // Body: { name?, type?, description?, add_trade_ids[]?, remove_trade_ids[]? }
  if (method === 'PATCH' && query.id) {
    const { name, type, description, add_trade_ids = [], remove_trade_ids = [] } = body

    // Update strategy metadata
    const updates = {}
    if (name        !== undefined) updates.name        = name
    if (type        !== undefined) updates.type        = type
    if (description !== undefined) updates.description = description

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from('strategies').update(updates).eq('id', query.id)
      if (error) return res.status(500).json({ error: error.message })
    }

    // Tag additional trades
    if (add_trade_ids.length > 0) {
      const { error } = await supabase
        .from('trades')
        .update({ strategy_id: query.id })
        .in('id', add_trade_ids)
      if (error) return res.status(500).json({ error: error.message })
    }

    // Untag trades (set to null)
    if (remove_trade_ids.length > 0) {
      const { error } = await supabase
        .from('trades')
        .update({ strategy_id: null })
        .in('id', remove_trade_ids)
      if (error) return res.status(500).json({ error: error.message })
    }

    return res.status(200).json({
      success: true,
      tagged: add_trade_ids.length,
      untagged: remove_trade_ids.length,
    })
  }

  // ── DELETE /api/strategies?id=<uuid> ─────────────────────────────────────
  // Delete strategy (trades get strategy_id set to null via ON DELETE SET NULL)
  if (method === 'DELETE' && query.id) {
    const { error } = await supabase.from('strategies').delete().eq('id', query.id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
