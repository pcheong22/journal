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

    // Fetch trades with server-side date + account filtering
    let query = supabase
      .from('trades')
      .select('*')
      .order('entry_time', { ascending: false, nullsFirst: false })
      .order('exit_time',  { ascending: false })

    if (accountIds?.length) query = query.in('account_id', accountIds)

    // For date filtering: use entry_time when available, fall back to exit_time
    // Trades with null entry_time (e.g. Extended) are always included unless filtered out
    if (from && to) {
      query = query.or(
        `entry_time.gte.${from},entry_time.is.null`
      ).or(
        `entry_time.lte.${to},entry_time.is.null`
      )
    } else if (from) {
      query = query.or(`entry_time.gte.${from},entry_time.is.null`)
    } else if (to) {
      query = query.or(`entry_time.lte.${to},entry_time.is.null`)
    }

    const { data: trades, error } = await query
    if (error) throw new Error(error.message)

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
