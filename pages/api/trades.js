import { requireOwner } from '../../lib/serverAuth'
import { createClient } from '@supabase/supabase-js'
import { executionIndex } from '../../lib/executionStore'
import { reportingTrade } from '../../lib/symbols'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const executionStorage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY)

export default async function handler(req, res) {
  if (!await requireOwner(req, res)) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { accounts: accountsParam, from, to } = req.query
    const accountIds = accountsParam ? accountsParam.split(',').filter(Boolean) : null

    // Fetch all trades — Supabase default limit is 1000, so fetch in batches
    let allTrades = []
    let from_idx  = 0
    const BATCH   = 1000
    while (true) {
      let q = supabase
        .from('trades')
        .select('*,trade_tag_mappings(tag_id)')
        .order('exit_time',  { ascending: false, nullsFirst: false })
        .order('entry_time', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true })
        .range(from_idx, from_idx + BATCH - 1)

      if (accountIds?.length) q = q.in('account_id', accountIds)

      // index.js already sends fully-formed ISO strings:
      //   from = "2026-01-01T00:00:00Z"
      //   to   = "2026-06-01T23:59:59Z"
      // Use them directly — do NOT append time suffixes here.
      if (from) q = q.gte('exit_time', from)
      if (to)   q = q.lte('exit_time', to)

      const { data: batch, error } = await q
      if (error) throw new Error(error.message)
      if (!batch?.length) break
      allTrades = allTrades.concat(batch)
      if (batch.length < BATCH) break
      from_idx += BATCH
    }

    const indices = {}
    let executionWarning = null
    await Promise.all([...new Set(allTrades.filter(trade => ['TxFlow', 'Hyperliquid'].includes(trade.broker)).map(trade => trade.account_id))].map(async account => {
      try { indices[account] = await executionIndex(executionStorage, account) }
      catch (error) { console.error('Execution summary:', error.message); executionWarning = 'Execution counts are temporarily unavailable.' }
    }))
    const trades = allTrades.map(({ trade_tag_mappings, ...trade }) => ({ ...reportingTrade(trade), tag_ids: (trade_tag_mappings || []).map(item => item.tag_id), execution_count: indices[trade.account_id]?.[trade.id]?.count || null }))

    // Fetch accounts
    const { data: accounts, error: accountsError } = await supabase.from('accounts').select('*').order('created_at')

    // Fetch tags
    const { data: tags, error: tagsError } = await supabase.from('trade_tags').select('*').order('category').order('name')

    if (accountsError || tagsError) throw new Error('Could not load account or tag data. Please retry.')
    return res.status(200).json({
      trades:   trades   || [],
      accounts: accounts || [],
      tags:     tags     || [],
      executionWarning,
    })
  } catch (err) {
    console.error('Fetch error:', err)
    return res.status(500).json({ error: err.message })
  }
}
