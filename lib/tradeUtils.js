// Add inside your main parser switch/if block:
if (broker === 'Hyperliquid') {
  // Detect by 'cloid' or 'oid' column, or 'coin'/'px'/'sz' headers
  const headers = rows[0]
  const isHL = headers.includes('cloid') || headers.includes('coin')
  if (!isHL) throw new Error('Not a valid Hyperliquid export')
  
  const accId = filename || `hyperliquid_${Date.now()}`
  const trades = rows.slice(1).filter(r => r[0] && r[1]).map((r,i) => ({
    position_id: `HL_${r[0]}_${i}`,
    account_id: accId,
    broker: 'Hyperliquid',
    entry_time: new Date(r[1]).toISOString(),
    symbol: r[2]?.replace(/\s*\(para\)/,'') || 'UNKNOWN',
    direction: r[3]?.toLowerCase().includes('buy') ? 'Long' : 'Short',
    size: parseFloat(r[5]) || 0,
    entry_price: parseFloat(r[4]) || 0,
    pnl: parseFloat(r[7]) || 0,
    currency: 'USD'
  }))
  return { broker: 'Hyperliquid', accountId: accId, currency: 'USD', trades }
}

if (broker === 'IBKR') {
  // Detect by 'Trades' section header or 'Date/Time' column
  const trades = []
  let inTradesSection = false
  for (const row of rows) {
    if (row[0] === 'Trades' && row[1] === 'Header') { inTradesSection = true; continue }
    if (!inTradesSection || row[0] === 'Total') continue
    
    const timeStr = row[2] // Date/Time column
    const qty = parseFloat(row[4])
    if (!timeStr || isNaN(qty)) continue
    
    trades.push({
      position_id: `IBKR_${row[3]}_${timeStr.replace(/[^0-9]/g,'')}`,
      account_id: 'IBKR_U11154227',
      broker: 'IBKR',
      entry_time: new Date(timeStr.replace(' ', 'T') + 'Z').toISOString(),
      symbol: row[3],
      direction: qty > 0 ? 'Long' : 'Short',
      size: Math.abs(qty),
      entry_price: parseFloat(row[6]),
      exit_price: parseFloat(row[7]),
      pnl: parseFloat(row[10]),
      currency: 'USD'
    })
  }
  return { broker: 'IBKR', accountId: 'IBKR_U11154227', currency: 'USD', trades }
}
