// Recognise pre-HL2 imports, including native CSVs once interpreted as UTC.
// Matching is account-scoped and requires the original coin, close timestamp,
// direction, quantity and P&L. Never deduplicate fills: identical native rows
// can be separate executions, since that export has no execution IDs.
const legacyId = trade => trade.position_id?.match(/^HL_(.+)_(\d+)_(\d+)$/)
const near = (a, b, tolerance) => a != null && b != null && Math.abs(Number(a) - Number(b)) <= tolerance

export function matchesHyperliquidTrade(existing, incoming, utcTrade) {
  if (existing.account_id !== incoming.account_id || existing.broker !== 'Hyperliquid') return false
  if (existing.position_id === incoming.position_id) return true
  const old = legacyId(existing)
  if (!old || existing.direction !== incoming.direction) return false
  const identity = incoming.position_id.match(/^HL2_(.*)_(Long|Short)_\d+$/)
  if (!identity) return false
  const coin = decodeURIComponent(identity[1]).replace(/\W/g, '')
  if (old[1] !== coin) return false
  if (!near(existing.size, incoming.size, 0.000001) || !near(existing.pnl, incoming.pnl, 0.011)) return false
  if (!near(existing.exit_price, incoming.exit_price, 0.00011)) return false

  return [incoming, utcTrade].filter(Boolean).some(candidate => {
    if (Number(old[2]) !== Date.parse(candidate.exit_time)) return false
    if (Date.parse(existing.exit_time) !== Date.parse(candidate.exit_time)) return false
    // Entry data can have been enriched by Hypurrscan; use it when available
    // to distinguish genuinely separate positions with identical results.
    return !existing.entry_time || !candidate.entry_time ||
      Date.parse(existing.entry_time) === Date.parse(candidate.entry_time)
  })
}

function check(result) {
  if (result.error) throw new Error(`Hyperliquid reconciliation: ${result.error.message}`)
  return result.data
}

const journalFields = ['notes', 'note_entry_reason', 'note_management', 'note_lessons',
  'note_emotional_state', 'stop_loss', 'r_multiple', 'strategy_id']

export async function reconcileHyperliquid(supabase, incoming, utcTrades) {
  const accountId = incoming[0].account_id
  const existing = []
  // Do not let Supabase's 1,000-row default hide earlier imports.
  for (let start = 0; ; start += 1000) {
    const batch = check(await supabase.from('trades').select('*')
      .eq('account_id', accountId).order('id').range(start, start + 999)) || []
    existing.push(...batch)
    if (batch.length < 1000) break
  }
  const newTrades = []
  const plans = []
  const claimed = new Set()
  for (let i = 0; i < incoming.length; i++) {
    const trade = incoming[i]
    const matches = existing.filter(row => matchesHyperliquidTrade(row, trade, utcTrades?.[i]))
    if (!matches.length) { newTrades.push(trade); continue }
    if (matches.some(row => claimed.has(row.id))) {
      throw new Error('Ambiguous Hyperliquid trade match; no trades changed. Upload the complete history.')
    }
    matches.forEach(row => claimed.add(row.id))
    let keep = matches.find(row => row.position_id === trade.position_id) || matches[0]
    if (matches.length > 1) {
      const ids = matches.map(row => row.id)
      const tags = check(await supabase.from('trade_tag_mappings').select('trade_id').in('trade_id', ids)) || []
      const images = check(await supabase.from('trade_images').select('entity_id')
        .eq('entity_type', 'trade').in('entity_id', ids.map(String))) || []
      const annotated = matches.filter(row => journalFields.some(field => row[field] != null && row[field] !== '') ||
        tags.some(tag => String(tag.trade_id) === String(row.id)) ||
        images.some(image => String(image.entity_id) === String(row.id)))
      // Preserve the original journal row and its references. Multiple annotated
      // copies need a deliberate merge, rather than losing conflicting notes.
      if (annotated.length > 1) {
        throw new Error('Duplicate Hyperliquid trades contain separate journal data; merge them before re-uploading. No trades changed.')
      }
      if (annotated.length) keep = annotated[0]
    }
    plans.push({ trade, keep, remove: matches.filter(row => row.id !== keep.id) })
  }

  let removed = 0
  for (const { trade, keep, remove } of plans) {
    if (!legacyId(keep) && !remove.length) continue
    // Keep the row ID, notes, strategies, tags, screenshots and enriched entries.
    // If a redundant copy owns the HL2 ID, free it before renaming the keeper.
    const payload = { ...trade }
    if (remove.some(row => row.position_id === trade.position_id)) delete payload.position_id
    if (keep.entry_price != null) payload.entry_price = keep.entry_price
    if (keep.order_type) payload.order_type = keep.order_type
    check(await supabase.from('trades').update(payload).eq('account_id', accountId).eq('id', keep.id)
      .select('id').single())
    if (remove.length) {
      const deleted = check(await supabase.from('trades').delete().eq('account_id', accountId)
        .in('id', remove.map(row => row.id)).select('id')) || []
      removed += deleted.length
    }
    if (!payload.position_id) {
      check(await supabase.from('trades').update({ position_id: trade.position_id })
        .eq('account_id', accountId).eq('id', keep.id).select('id').single())
    }
  }
  return { newTrades, duplicates: plans.length, reconciled: plans.length, removed }
}
