import * as XLSX from 'xlsx'

const VOL_MAP = { 'BTC/USDT': 50, 'ETH/USDT': 5, 'NAS': 8, 'SPX': 3 }

export function simulatePnLPath(trade) {
  if (!trade.pnl || !trade.entry_price) return null
  const seed = parseInt(trade.position_id?.replace(/\D/g, '')?.slice(-8) || Math.random() * 100000000)
  const rand = s => { s = Math.sin(s) * 43758.5453123; return s - Math.floor(s) }
  const dur = trade.duration_mins || 60
  const nPts = Math.max(10, Math.min(100, Math.round(dur / 5)))
  const diff = trade.pnl / (trade.size * trade.entry_price) * 10000
  const vol = (VOL_MAP[trade.symbol] || 0.1) * 0.001
  const W = new Array(nPts + 1).fill(0)
  for (let i = 1; i <= nPts; i++) W[i] = W[i - 1] + (rand(seed + i * 7.3) * 2 - 1) * Math.sqrt(1 / nPts)
  const Wf = W[nPts], tArr = Array.from({ length: nPts + 1 }, (_, i) => i / nPts)
  const prices = tArr.map((ti, i) => {
    const bridge = W[i] - ti * Wf + ti * diff
    const noise = (i === 0 || i === nPts) ? 0 : (rand(seed + i * 13.7) - 0.5) * vol * 0.6
    return 1 + bridge + noise
  })
  let path = prices.map(p => trade.direction === 'Long' ? (p - 1) * trade.pnl : (1 - p) * trade.pnl)
  path[0] = 0; path[nPts] = trade.pnl
  const mae = Math.min(...path); const mfe = Math.max(...path)
  return { timePct: tArr.map(t => Math.round(t * 100)), pnlPath: path.map(p => Math.round(p * 100) / 100), mae, mfe }
}

export function parseTradeFile(rows, filename, accountIdOverride = null) {
  if (!rows || rows.length < 2) throw new Error('File empty')
  
  let broker = 'Generic'
  const hRow = rows.findIndex(r => r && r.length > 3)
  if (hRow === -1) throw new Error('No header found')
  const header = rows[hRow].join(' ').toLowerCase()

  if (header.includes('order id') && header.includes('placed time')) broker = 'PrimeXBT'
  else if (header.includes('market') && header.includes('side') && header.includes('qty')) broker = 'Bybit'
  else if (header.includes('cloid') || header.includes('coin')) broker = 'Hyperliquid'
  else if (header.includes('date/time') && header.includes('realized p/l')) broker = 'IBKR'

  // Helper to parse DD/MM/YYYY HH:MM format (PrimeXBT format)
  const parsePrimeXBTDate = (dateStr) => {
    if (!dateStr) return new Date().toISOString()
    // Format: "14/02/2025 18:58" or "07/02/2025 15:03"
    const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/)
    if (match) {
      const [, day, month, year, hours, mins] = match
      return new Date(Date.UTC(
        parseInt(year),
        parseInt(month) - 1, // JS months are 0-indexed
        parseInt(day),
        parseInt(hours),
        parseInt(mins)
      )).toISOString()
    }
    return new Date().toISOString()
  }

  let trades = []
  let detectedAccountId = accountIdOverride

  if (broker === 'PrimeXBT') {
    trades = rows.slice(hRow + 1)
      .filter(r => {
        // Skip FINANCING, DEPOSIT, WITHDRAWAL rows
        const orderType = r[2]?.trim().toUpperCase()
        return orderType !== 'FINANCING' && orderType !== 'DEPOSIT' && orderType !== 'WITHDRAWAL'
      })
      .map(r => {
        const entryTimeStr = r[2]?.trim()
        const exitTimeStr = r[3]?.trim()
        
        return {
          position_id: `PXT_${r[0]}_${entryTimeStr?.replace(/[^0-9]/g, '')}`,
          entry_time: parsePrimeXBTDate(entryTimeStr),
          exit_time: parsePrimeXBTDate(exitTimeStr),
          symbol: String(r[6]).trim(),
          direction: String(r[5]).trim().toUpperCase() === 'BUY' ? 'Long' : 'Short',
          size: parseFloat(String(r[5]).replace(/,/g, '')) || 0,
          entry_price: parseFloat(String(r[7]).replace(/,/g, '')) || 0,
          exit_price: parseFloat(String(r[8]).replace(/,/g, '')) || 0,
          pnl: parseFloat(String(r[9]).replace(/,/g, '')) || 0,
          fee: parseFloat(String(r[10]).replace(/,/g, '')) || 0
        }
      })
  } else if (broker === 'Hyperliquid') {
    detectedAccountId = detectedAccountId || filename || `hyperliquid_${Date.now()}`
    trades = rows.slice(hRow + 1).map(r => ({
      position_id: `HL_${r[0]}_${r[1]}`,
      symbol: String(r[2]).trim().replace(/\s*\(para\)/, ''),
      direction: String(r[3]).trim().toLowerCase().includes('buy') ? 'Long' : 'Short',
      size: parseFloat(r[5]) || 0,
      entry_price: parseFloat(r[4]) || 0,
      pnl: parseFloat(r[7]) || 0,
      entry_time: new Date(r[0]).toISOString()
    }))
  } else if (broker === 'IBKR') {
    detectedAccountId = detectedAccountId || 'IBKR_U11154227'
    trades = rows.slice(hRow + 1)
      .filter(r => r[0] === 'Trades' && r[1] === 'Data')
      .map(r => ({
        position_id: `IBKR_${r[5]}_${r[6].replace(/[^0-9]/g,'')}`,
        symbol: String(r[5]).trim(),
        direction: parseFloat(r[7]) > 0 ? 'Long' : 'Short',
        size: Math.abs(parseFloat(r[7])) || 0,
        entry_price: parseFloat(r[8]) || 0,
        pnl: parseFloat(r[13]) || 0,
        entry_time: new Date(r[6]).toISOString()
      }))
  } else {
    detectedAccountId = detectedAccountId || 'default'
    trades = rows.slice(hRow + 1).map(r => ({
      position_id: String(r[0]).trim(),
      symbol: String(r[4]).trim(),
      direction: String(r[2]).trim(),
      size: parseFloat(r[3]) || 0,
      entry_price: parseFloat(r[6]) || 0,
      pnl: parseFloat(r[9]) || 0,
      entry_time: new Date(r[2]).toISOString()
    }))
  }

  return { trades, broker, detectedAccountId, skipped: 0 }
}
export function computeStats(trades) {
  if (!trades || trades.length === 0) return null
  return { 
    total_pnl: trades.reduce((a, b) => a + (b.pnl || 0), 0), 
    total_trades: trades.length 
  }
}
