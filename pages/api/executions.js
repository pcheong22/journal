import { requireOwner } from '../../lib/serverAuth'
import { createClient } from '@supabase/supabase-js'
import { readExecutionRecord } from '../../lib/executionStore'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY)
export default async function handler(req, res) {
  if (!await requireOwner(req, res)) return
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!/^\d+$/.test(String(req.query.tradeId || ''))) return res.status(400).json({ error: 'A valid trade ID is required' })
  try {
    const { data: trade, error } = await supabase.from('trades').select('id,account_id,position_id').eq('id', req.query.tradeId).single()
    if (error || !trade) return res.status(404).json({ error: 'Trade not found' })
    const record = await readExecutionRecord(supabase, trade)
    return res.status(200).json({ record })
  } catch (error) {
    console.error('Executions:', error.message)
    return res.status(500).json({ error: 'Execution details could not be loaded. Please try again.' })
  }
}
