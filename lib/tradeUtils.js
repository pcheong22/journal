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

// Helper to parse various date formats
function parseDate(dateStr) {
  if (!dateStr) return new Date().toISOString()
  
  // Try ISO format first
  if (typeof dateStr === 'string' && dateStr.includes('T')) {
    const d = new Date(dateStr)
    if (!isNaN(d.getTime())) return d.toISOString()
  }
  
  // Try DD/MM/YYYY HH:MM format (PrimeXBT)
  const match = String(dateStr).match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/)
  if (match) {
    const [, day, month, year, hours, mins] = match
    const d = new Date(Date.UTC(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hours),
      parseInt(mins)
    ))
    if (!isNaN(d.getTime())) return d.toISOString()
  }
  
  // Try YYYY-MM-DD HH:MM:SS format
  const match2 = String(dateStr).match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/)
  if (match2) {
    const [, year, month, day, hours, mins, secs] = match2
    const d = new Date(Date.UTC(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hours),
      parseInt(mins),
      parseInt(secs)
    ))
    if (!isNaN(d.getTime())) return d.toISOString()
  }
  
  // Try generic date parsing
  const d = new Date(dateStr)
  if (!isNaN(d.getTime())) return d.toISOString()
  
  // Fallback to current time
  return new Date().toISOString()
}

export function parseTradeFile(rows, filename, accountIdOverride = null) {
  if (!rows || rows.length < 2) throw new Error('File empty')
  
  let broker = 'Generic'
  const hRow = rows.findIndex(r => r && r.length > 3)
  if (hRow === -1) throw new Error('No header found')
  const header = rows[hRow].join(' ').toLowerCase()

  // Detect broker type
  if (header.includes('order id') && header.includes('placed time')) broker = 'PrimeXBT'
  else if (header.includes('market') && header.includes('side') && header.includes('qty')) broker = 'Bybit'
  else if (header.includes('cloid') || header.includes('coin')) broker = 'Hyperliquid'
  else if (header.includes('date/time') && header.includes('realized p/l')) broker = 'IBKR'
  else if (header.includes('direction') && header.includes('size') && header.includes('entry price')) broker = 'Extended'

  let trades = []
  let detectedAccountId = accountIdOverride

  if (broker === 'PrimeXBT') {
    // PrimeXBT HTML format
    trades = rows.slice(hRow + 1)
      .filter(r => {
        const status = String(r[4] || '').trim().toUpperCase()
        return status === 'EXECUTED' || status === 'FILLED'
      })
      .map(r => {
        const entryTime = parseDate(r[2])
        return {
          position_id: `PXT_${r[0]}_${Date.parse(entryTime)}`,
          entry_time: entryTime,
          exit_time: parseDate(r[3]),
          symbol: String(r[6] || r[1] || 'UNKNOWN').trim(),
          direction: String(r[5] || r[3] || '').trim().toUpperCase() === 'BUY' ? 'Long' : 'Short',
          size: parseFloat(String(r[5] || r[7] || '0').replace(/,/g, '')) || 0,
          entry_price: parseFloat(String(r[7] || r[8] || '0').replace(/,/g, '')) || 0,
          exit_price: parseFloat(String(r[8] || r[9] || '0').replace(/,/g, '')) || 0,
          pnl: parseFloat(String(r[9] || r[10] || '0').replace(/,/g, '')) || 0,
          fee: parseFloat(String(r[10] || r[11] || '0').replace(/,/g, '')) || 0
        }
      })
  } else if (broker === 'Hyperliquid') {
    // Hyperliquid format
    detectedAccountId = detectedAccountId || filename || `hyperliquid_${Date.now()}`
    trades = rows.slice(hRow + 1)
      .filter(r => r[0] && r[2])
      .map(r => {
        const entryTime = parseDate(r[0])
        return {
          position_id: `HL_${r[0]}_${Date.parse(entryTime)}`,
          entry_time: entryTime,
          symbol: String(r[2] || 'UNKNOWN').trim().replace(/\s*\(para\)/, ''),
          direction: String(r[3] || '').trim().toLowerCase().includes('buy') ? 'Long' : 'Short',
          size: parseFloat(r[5] || r[4] || '0') || 0,
          entry_price: parseFloat(r[4] || r[3] || '0') || 0,
          pnl: parseFloat(r[7] || r[6] || '0') || 0
        }
      })
  } else if (broker === 'IBKR') {
    // IBKR format
    detectedAccountId = detectedAccountId || 'IBKR_U11154227'
    trades = rows.slice(hRow + 1)
      .filter(r => r[0] === 'Trades' && r[1] === 'Data')
      .map(r => {
        const entryTime = parseDate(r[6])
        const qty = parseFloat(r[7] || '0')
        return {
          position_id: `IBKR_${r[5]}_${Date.parse(entryTime)}`,
          entry_time: entryTime,
          symbol: String(r[5] || 'UNKNOWN').trim(),
          direction: qty > 0 ? 'Long' : 'Short',
          size: Math.abs(qty) || 0,
          entry_price: parseFloat(r[8] || '0') || 0,
          pnl: parseFloat(r[13] || '0') || 0
        }
      })
  } else if (broker === 'Bybit') {
    // Bybit format
    detectedAccountId = detectedAccountId || 'bybit_spot'
    trades = rows.slice(hRow + 1)
      .filter(r => r[0] && r[1])
      .map(r => {
        const entryTime = parseDate(r[11] || r[10])
        return {
          position_id: `BYB_${r[9] || r[8]}_${Date.parse(entryTime)}`,
          entry_time: entryTime,
          symbol: String(r[0] || 'UNKNOWN').trim(),
          direction: String(r[1] || '').trim().toUpperCase() === 'BUY' ? 'Long' : 'Short',
          size: parseFloat(r[2] || '0') || 0,
          entry_price: parseFloat(r[6] || r[5] || '0') || 0,
          pnl: parseFloat(r[8] || '0') || 0
        }
      })
  } else {
    // Generic format
    detectedAccountId = detectedAccountId || 'generic'
    trades = rows.slice(hRow + 1)
      .filter(r => r[0] && r[4])
      .map(r => {
        const entryTime = parseDate(r[2])
        return {
          position_id: String(r[0] || `GEN_${Date.now()}_${Math.random()}`).trim(),
          entry_time: entryTime,
          exit_time: parseDate(r[3]),
          symbol: String(r[4] || 'UNKNOWN').trim(),
          direction: String(r[2] || 'Long').trim(),
          size: parseFloat(r[5] || '0') || 0,
          entry_price: parseFloat(r[6] || '0') || 0,
          exit_price: parseFloat(r[7] || '0') || 0,
          pnl: parseFloat(r[9] || '0') || 0
        }
      })
  }

  return { trades, broker, detectedAccountId, skipped: 0 }
}

export function computeStats(trades) {
  if (!trades || trades.length === 0) return null
  
  const wins = trades.filter(t => t.pnl > 0)
  const losses = trades.filter(t => t.pnl < 0)
  const longs = trades.filter(t => t.direction === 'Long')
  const shorts = trades.filter(t => t.direction === 'Short')
  
  const gs = ts => ({
    total_trades: ts.length,
    total_pnl: ts.reduce((s, t) => s + (t.pnl || 0), 0),
    win_rate: ts.length ? ts.filter(t => t.pnl > 0).length / ts.length : 0
  })
  
  const grpBy = (arr, k) => arr.reduce((a, t) => {
    const key = t[k] || 'Unknown'
    ;(a[key] = a[key] || []).push(t)
    return a
  }, {})
  
  const monthG = grpBy(trades, t => t.entry_time?.slice(0, 7))
  const dateG = grpBy(trades, t => t.entry_time?.slice(0, 10))
  
  const sorted = [...trades].sort((a, b) => a.entry_time.localeCompare(b.entry_time))
  let cum = 0
  const cumByDate = {}
  sorted.forEach(t => {
    cum += t.pnl || 0
    cumByDate[t.entry_time?.slice(0, 10)] = cum
  })
  
  return {
    overview: {
      total_trades: trades.length,
      total_pnl: trades.reduce((s, t) => s + (t.pnl || 0), 0),
      win_rate: wins.length / trades.length,
      avg_win: wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0,
      avg_loss: losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0,
      best_trade: trades.length ? Math.max(...trades.map(t => t.pnl || 0)) : 0,
      worst_trade: trades.length ? Math.min(...trades.map(t => t.pnl || 0)) : 0,
      long_pnl: longs.reduce((s, t) => s + (t.pnl || 0), 0),
      short_pnl: shorts.reduce((s, t) => s + (t.pnl || 0), 0)
    },
    symbols: Object.entries(grpBy(trades, 'symbol')).map(([symbol, ts]) => ({
      symbol,
      ...gs(ts)
    })).sort((a, b) => b.total_pnl - a.total_pnl),
    monthly: Object.entries(monthG).map(([month_str, ts]) => ({
      month_str,
      ...gs(ts)
    })).sort((a, b) => a.month_str.localeCompare(b.month_str)),
    daily: Object.entries(dateG).map(([date, ts]) => ({
      date,
      ...gs(ts)
    })).sort((a, b) => a.date.localeCompare(b.date)),
    cumulative: Object.entries(cumByDate).map(([date, cum_pnl]) => ({
      date,
      cum_pnl
    })).sort((a, b) => a.date.localeCompare(b.date))
  }
}