// pages/api/trade-notes.js
// Save structured + free-text notes and tags to a trade
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const {
      tradeId,
      notes,
      note_entry_reason,
      note_management,
      note_lessons,
      note_emotional_state,
      stop_loss,
      tagIds,   // array of tag IDs to set (replaces existing)
    } = req.body

    if (!tradeId) return res.status(400).json({ error: 'tradeId required' })

    // Fetch trade for R-Multiple calc
    const { data: trade } = await supabase.from('trades').select('entry_price, exit_price, direction').eq('id', tradeId).single()

    // Compute R-Multiple if stop_loss provided
    let r_multiple = null
    if (stop_loss && trade?.entry_price && trade?.exit_price) {
      const ep = trade.entry_price, xp = trade.exit_price, sl = stop_loss
      const risk   = trade.direction === 'Long' ? ep - sl : sl - ep
      const reward = trade.direction === 'Long' ? xp - ep : ep - xp
      if (risk > 0) r_multiple = Math.round((reward / risk) * 100) / 100
    }

    // Update trade record
    const updateFields = {}
    if (notes                !== undefined) updateFields.notes                = notes
    if (note_entry_reason    !== undefined) updateFields.note_entry_reason    = note_entry_reason
    if (note_management      !== undefined) updateFields.note_management      = note_management
    if (note_lessons         !== undefined) updateFields.note_lessons         = note_lessons
    if (note_emotional_state !== undefined) updateFields.note_emotional_state = note_emotional_state
    if (stop_loss            !== undefined) updateFields.stop_loss            = stop_loss
    if (r_multiple           !== null)      updateFields.r_multiple           = r_multiple

    if (Object.keys(updateFields).length > 0) {
      const { error } = await supabase.from('trades').update(updateFields).eq('id', tradeId)
      if (error) throw new Error(`Trade update error: ${error.message}`)
    }

    // Replace tags if provided
    if (Array.isArray(tagIds)) {
      await supabase.from('trade_tag_mappings').delete().eq('trade_id', tradeId)
      if (tagIds.length > 0) {
        const mappings = tagIds.map(tag_id => ({ trade_id: tradeId, tag_id }))
        const { error } = await supabase.from('trade_tag_mappings').insert(mappings)
        if (error) throw new Error(`Tag mapping error: ${error.message}`)
      }
    }

    return res.status(200).json({ success: true, r_multiple })
  } catch (err) {
    console.error('Notes save error:', err)
    return res.status(500).json({ error: err.message })
  }
}
