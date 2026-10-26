import { requireOwner } from '../../lib/serverAuth'
// pages/api/accounts.js
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (!await requireOwner(req, res)) return
  if (req.method === 'GET') {
    const { data, error } = await supabase.from('accounts').select('*').order('created_at')
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ accounts: data || [] })
  }

  if (req.method === 'PATCH') {
    const { id, label, color } = req.body
    if (!id) return res.status(400).json({ error: 'Account ID required' })
    const updates = {}
    if (label !== undefined) updates.label = label
    if (color !== undefined) updates.color = color
    const { error } = await supabase.from('accounts').update(updates).eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  // Register a Hyperliquid wallet before its first trade-history upload.
  if (req.method === 'POST') {
    const { id } = req.body || {}
    if (typeof id !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(id)) {
      return res.status(400).json({ error: 'A valid Hyperliquid wallet address is required' })
    }
    const { error } = await supabase.from('accounts').upsert({
      id,
      broker: 'Hyperliquid',
      label: `Hyperliquid ${id.slice(0, 6)}....${id.slice(-4)}`,
      currency: 'USDC',
      color: '#97FCE4',
    }, { onConflict: 'id', ignoreDuplicates: true })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
