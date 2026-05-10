import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { parseTradeFile } from '../../lib/tradeUtils'

// Tell Next.js not to parse the body automatically so we can use formData
export const config = { api: { bodyParser: false } }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  try {
    // 1. Read the form data
    const formData = await req.formData()
    const file = formData.get('file')
    const accountId = formData.get('accountId') // This comes from the Modal

    if (!file || !accountId) return res.status(400).json({ error: 'Missing file or Account ID' })

    // 2. Parse the file using our utility
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 })

    // Use the manual account ID selected by the user
    const { trades, broker } = await parseTradeFile(json, file.name, accountId)

    if (!trades.length) return res.status(400).json({ error: 'No valid trades found. Check file format.' })

    // 3. Ensure Account Exists
    const {  existingAcc } = await supabase.from('accounts').select('id').eq('id', accountId).single()
    if (!existingAcc) {
      await supabase.from('accounts').insert({
        id: accountId,
        broker: broker || 'Generic',
        label: accountId,
        currency: 'USD',
        color: '#4bde80'
      })
    }

    // 4. Insert Trades (Skip Duplicates)
    const { data: existingIds } = await supabase.from('trades').select('position_id').eq('account_id', accountId)
    const existingSet = new Set((existingIds || []).map(t => t.position_id))
    const newTrades = trades.filter(t => !existingSet.has(t.position_id)).map(t => ({...t, account_id: accountId}))

    if (newTrades.length) {
      const { error } = await supabase.from('trades').insert(newTrades)
      if (error) throw error
    }

    return res.status(200).json({ 
      success: true, 
      count: newTrades.length, 
      skipped: trades.length - newTrades.length 
    })

  } catch (err) {
    console.error('Upload Error:', err)
    return res.status(500).json({ error: err.message })
  }
}
