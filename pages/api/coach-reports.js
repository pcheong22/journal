// pages/api/coach-reports.js
// CRUD for saved AI coaching reports
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {

  // GET — list all saved reports, newest first
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('coach_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ reports: data || [] })
  }

  // POST — save a new report
  if (req.method === 'POST') {
    const {
      period, date_from, date_to, trade_count,
      score, archetype, core_edge, core_weakness,
      coaching_tip, insights, provider,
    } = req.body

    const { data, error } = await supabase.from('coach_reports').insert({
      period,
      date_from,
      date_to,
      trade_count,
      score,
      archetype,
      core_edge,
      core_weakness,
      coaching_tip,
      insights:  JSON.stringify(insights),
      provider,
    }).select().single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ report: data })
  }

  // DELETE — remove a saved report by id
  if (req.method === 'DELETE') {
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id required' })
    const { error } = await supabase.from('coach_reports').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
