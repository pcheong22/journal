// pages/api/clear.js
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const accountId = req.query.account
    if (accountId) {
      await supabase.from('accounts').delete().eq('id', accountId)
      return res.status(200).json({ message: `Account ${accountId} and all its trades deleted` })
    }
    await supabase.from('trades').delete().neq('id', 0)
    await supabase.from('accounts').delete().neq('id', '')
    return res.status(200).json({ message: 'All data cleared' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
