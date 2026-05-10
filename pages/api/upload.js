import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { parseTradeFile } from '../../lib/tradeUtils'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  try {
    const { fileContent, fileName, accountId } = req.body
    if (!fileContent || !accountId) return res.status(400).json({ error: 'Missing data' })

    // Decode Base64 (removes the "data:text/csv;base64," prefix)
    const base64Data = fileContent.replace(/^data:[a-zA-Z/]*;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')

    // Parse the Excel/CSV buffer
    const workbook = XLSX.read(buffer, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 })

    // Process trades using your utility
    const { trades, broker } = await parseTradeFile(json, fileName, accountId)

    if (!trades.length) return res.status(400).json({ error: 'No valid trades found. Check file format.' })

    // 1. Ensure Account Exists
// In the upload handler, replace the account creation part:
const {  existingAcc } = await supabase.from('accounts').select('id').eq('id', accountId).single()
if (!existingAcc) {
  // Extract broker name from accountId or use default
  let brokerName = 'Generic'
  let labelName = accountId
  
  if (accountId.includes('PXT') || accountId.includes('PrimeXBT')) {
    brokerName = 'PrimeXBT'
    labelName = accountId.replace(/_/g, ' ')
  } else if (accountId.includes('HL') || accountId.includes('hyperliquid')) {
    brokerName = 'Hyperliquid'
    labelName = accountId.replace(/_/g, ' ')
  } else if (accountId.includes('BYB') || accountId.includes('bybit')) {
    brokerName = 'Bybit'
    labelName = accountId.replace(/_/g, ' ')
  } else if (accountId.includes('IBKR')) {
    brokerName = 'IBKR'
    labelName = 'IBKR U11154227'
  }

  await supabase.from('accounts').insert({
    id: accountId,
    broker: brokerName,
    label: labelName,
    currency: 'USD',
    color: '#4bde80'
  })
}

    // 2. Insert Trades (Skip Duplicates)
    const {  existingIds } = await supabase.from('trades').select('position_id').eq('account_id', accountId)
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
