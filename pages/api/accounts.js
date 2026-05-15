// pages/api/accounts.js
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
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

  if (req.method === 'DELETE') {
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'Account ID required' })
    const { error } = await supabase.from('accounts').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
