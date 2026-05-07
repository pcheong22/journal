import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { error } = await supabase.from('trades').delete().neq('id', 0)
    if (error) throw new Error(error.message)
    return res.status(200).json({ message: 'All trades deleted' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
