import { createClient } from '@supabase/supabase-js'
import { requireOwner } from '../../lib/serverAuth'
import { noteRequest } from '../../lib/journalNotes'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
export default async function handler(req, res) {
  if (!await requireOwner(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error:'Method not allowed' })
  try {
    const args = noteRequest(req.body)
    const { data, error } = await supabase.rpc('journal_save_trade', args)
    if (error) {
      const status = error.code === '40001' ? 409 : error.code === 'P0002' ? 404 : ['22023','23503','22P02'].includes(error.code) ? 400 : 503
      return res.status(status).json({ error: status === 503 ? 'Could not save. Your changes are still here; please retry.' : error.message })
    }
    if (!data?.id) throw new Error('Missing saved trade')
    return res.status(200).json({ success:true, trade:data, r_multiple:data.r_multiple })
  } catch (error) { return res.status(error.status || 503).json({ error:error.status ? error.message : 'Could not save. Your changes are still here; please retry.' }) }
}
