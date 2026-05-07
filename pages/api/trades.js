import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    // Fetch all trades, newest first
    const { data, error, count } = await supabase
      .from('trades')
      .select('*', { count: 'exact' })
      .order('entry_time', { ascending: false })

    if (error) throw new Error(error.message)

    return res.status(200).json({ trades: data || [], count: count || 0 })
  } catch (err) {
    console.error('Fetch error:', err)
    return res.status(500).json({ error: err.message })
  }
}
