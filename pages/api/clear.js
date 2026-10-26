import { createFullBackup } from '../../lib/backupStore'
import { createClient } from '@supabase/supabase-js'
import { requireOwner } from '../../lib/serverAuth'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
export default async function handler(req, res) {
  if (!await requireOwner(req, res)) return
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' })
  const account = req.query.account || null
  if (account !== null && (typeof account !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(account))) return res.status(400).json({ error: 'Invalid account.' })
  const expected = account ? `DELETE ${account}` : 'DELETE ALL'
  if (req.headers['x-journal-delete'] !== expected) return res.status(400).json({ error: 'Type the deletion confirmation before continuing.' })
  // One database transaction; a failed operation must never report success.
  try { await createFullBackup(supabase,{},'automatic safety copy before account deletion') } catch { return res.status(503).json({error:'Could not create the safety backup. Nothing was deleted; please retry.'}) }
  const { error } = await supabase.rpc('journal_clear_accounts', { p_account_id: account })
  if (error) return res.status(503).json({ error: 'Could not delete account data. Please try again.' })
  return res.status(200).json({ message: account ? 'Account and its trades deleted.' : 'All accounts and trades deleted.' })
}
