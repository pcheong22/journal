import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  
  try {
    const { broker, label, currency } = req.body
    const accountId = `${broker.toLowerCase()}_${Date.now()}`
    
    const { data, error } = await supabase.from('accounts').insert([
      { id: accountId, broker, label, currency: currency || 'USD', color: '#4bde80' }
    ]).select().single()

    if (error) throw error
    return res.status(200).json({ accountId: data.id })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}