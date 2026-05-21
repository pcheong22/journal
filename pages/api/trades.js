// pages/api/trades.js
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
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
        .select('*')
        .order('entry_time', { ascending: false, nullsFirst: false })
        .order('exit_time',  { ascending: false })
        .range(from_idx, from_idx + BATCH - 1)

      if (accountIds?.length) q = q.in('account_id', accountIds)

      if (from && to) {
        q = q.or(`entry_time.gte.${from},entry_time.is.null`)
             .or(`entry_time.lte.${to},entry_time.is.null`)
      } else if (from) {
        q = q.or(`entry_time.gte.${from},entry_time.is.null`)
      } else if (to) {
        q = q.or(`entry_time.lte.${to},entry_time.is.null`)
      }

      const { data: batch, error } = await q
      if (error) throw new Error(error.message)
      if (!batch?.length) break
      allTrades = allTrades.concat(batch)
      if (batch.length < BATCH) break
      from_idx += BATCH
    }

    const trades = allTrades

    // Fetch accounts
    const { data: accounts } = await supabase.from('accounts').select('*').order('created_at')

    // Fetch tags
    const { data: tags } = await supabase.from('trade_tags').select('*').order('category, name')

    return res.status(200).json({
      trades:   trades   || [],
      accounts: accounts || [],
      tags:     tags     || [],
    })
  } catch (err) {
    console.error('Fetch error:', err)
    return res.status(500).json({ error: err.message })
  }
}
