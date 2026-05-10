import * as XLSX from 'xlsx'

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const VOL_MAP = { 'BTC/USDT': 50, 'ETH/USDT': 5, 'NAS': 8, 'SPX': 3 }

// ── P&L PATH SIMULATION ───────────────────────────────────────────────────────
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

// ── STATS COMPUTATION ─────────────────────────────────────────────────────────
export function computeStats(trades) {
  if (!trades || trades.length === 0) return null
  const wins = trades.filter(t => t.pnl > 0)
  const losses = trades.filter(t => t.pnl < 0)
  const longs = trades.filter(t => t.direction === 'Long')
  const shorts = trades.filter(t => t.direction === 'Short')
  const gs = ts => ({ total_trades: ts.length, total_pnl: ts.reduce((s, t) => s + t.pnl, 0), win_rate: ts.length ? ts.filter(t => t.pnl > 0).length / ts.length : 0 })
  const grpBy = (arr, k) => arr.reduce((a, t) => { (a[t[k]] = a[t[k]] || []).push(t); return a }, {})
  const monthG = grpBy(trades, t => t.entry_time?.slice(0, 7))
  const dateG = grpBy(trades, t => t.entry_time?.slice(0, 10))
  const sorted = [...trades].sort((a, b) => a.entry_time.localeCompare(b.entry_time))
  let cum = 0; const cumByDate = {}
  sorted.forEach(t => { cum += t.pnl; cumByDate[t.entry_time?.slice(0, 10)] = cum })
  return {
    overview: { total_trades: trades.length, total_pnl: trades.reduce((s, t) => s + t.pnl, 0), win_rate: wins.length / trades.length, avg_win: wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0, avg_loss: losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0, best_trade: trades.length ? Math.max(...trades.map(t => t.pnl)) : 0, worst_trade: trades.length ? Math.min(...trades.map(t => t.pnl)) : 0, long_pnl: longs.reduce((s, t) => s + t.pnl, 0), short_pnl: shorts.reduce((s, t) => s + t.pnl, 0) },
    symbols: Object.entries(grpBy(trades, 'symbol')).map(([symbol, ts]) => ({ symbol, ...gs(ts) })).sort((a, b) => b.total_pnl - a.total_pnl),
    monthly: Object.entries(monthG).map(([month_str, ts]) => ({ month_str, ...gs(ts) })).sort((a, b) => a.month_str.localeCompare(b.month_str)),
    daily: Object.entries(dateG).map(([date, ts]) => ({ date, ...gs(ts) })).sort((a, b) => a.date.localeCompare(b.date)),
    cumulative: Object.entries(cumByDate).map(([date, cum_pnl]) => ({ date, cum_pnl })).sort((a, b) => a.date.localeCompare(b.date))
  }
}

// ── PARSER: PRIMEXBT ──────────────────────────────────────────────────────────
function parsePrimeXBT(rows) {
  const trades = []
  const hRow = rows.findIndex(r => r && r.join(' ').toLowerCase().includes('order id') && r.join(' ').toLowerCase().includes('placed time'))
  if (hRow === -1) return trades
  for (let i = hRow + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length < 5) continue
    const status = String(r[4] || '').trim().toUpperCase()
    if (status !== 'EXECUTED') continue
    const entryTime = new Date(r[12])
    if (isNaN(entryTime)) continue
    trades.push({
      position_id: `PXT_${r[0]}_${entryTime.getTime()}`,
      entry_time: entryTime.toISOString(),
      symbol: String(r[1]).trim(),
      direction: String(r[3]).trim().toUpperCase() === 'BUY' ? 'Long' : 'Short',
      size: parseFloat(r[5]) || 0,
      entry_price: parseFloat(r[8]) || 0,
      pnl: parseFloat(r[10]) || 0,
      fee: parseFloat(r[9]) || 0
    })
  }
  return trades
}

// ── PARSER: HYPERLIQUID ───────────────────────────────────────────────────────
function parseHyperliquid(rows) {
  const trades = []
  const hRow = rows.findIndex(r => r && r.join(' ').toLowerCase().includes('cloid') || r && r.join(' ').toLowerCase().includes('coin'))
  if (hRow === -1) return trades
  for (let i = hRow + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length < 4) continue
    const entryTime = new Date(r[0])
    if (isNaN(entryTime)) continue
    const isBuy = String(r[2]).trim().toLowerCase().includes('buy')
    trades.push({
      position_id: `HL_${r[0]}_${i}`,
      entry_time: entryTime.toISOString(),
      symbol: String(r[1]).trim().replace(/\s*\(para\)/, ''),
      direction: isBuy ? 'Long' : 'Short',
      size: parseFloat(r[4]) || 0,
      entry_price: parseFloat(r[3]) || 0,
      pnl: parseFloat(r[7]) || 0
    })
  }
  return trades
}

// ── PARSER: IBKR ──────────────────────────────────────────────────────────────
function parseIBKR(rows) {
  const trades = []
  const hRow = rows.findIndex(r => r && r[0] === 'Date/Time' && r[3] === 'Symbol')
  if (hRow === -1) return trades
  for (let i = hRow + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length < 5) continue
    const entryTime = new Date(r[0])
    if (isNaN(entryTime)) continue
    const qty = parseFloat(r[4])
    trades.push({
      position_id: `IBKR_${r[3]}_${entryTime.getTime()}`,
      entry_time: entryTime.toISOString(),
      symbol: String(r[3]).trim(),
      direction: qty > 0 ? 'Long' : 'Short',
      size: Math.abs(qty),
      entry_price: parseFloat(r[6]) || 0,
      pnl: parseFloat(r[10]) || 0
    })
  }
  return trades
}

// ── PARSER: EXTENDED ──────────────────────────────────────────────────────────
function parseExtended(rows) {
  const trades = []
  const hRow = rows.findIndex(r => r && r[0] === 'Symbol' && r[1] === 'Direction')
  if (hRow === -1) return trades
  for (let i = hRow + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length < 3) continue
    const entryTime = new Date(r[10])
    if (isNaN(entryTime)) continue
    trades.push({
      position_id: `EXT_${entryTime.getTime()}_${i}`,
      entry_time: entryTime.toISOString(),
      symbol: String(r[0]).trim(),
      direction: String(r[1]).trim(),
      size: parseFloat(r[2]) || 0,
      entry_price: parseFloat(r[3]) || 0,
      pnl: parseFloat(r[5]) || 0
    })
  }
  return trades
}

// ── PARSER: BYBIT (Spot & UTA) ────────────────────────────────────────────────
function parseBybit(rows) {
  const trades = []
  const hRow = rows.findIndex(r => r && r.join(' ').toLowerCase().includes('order id') && r.join(' ').toLowerCase().includes('market'))
  if (hRow === -1) return trades
  for (let i = hRow + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length < 5) continue
    const entryTime = new Date(r[5])
    if (isNaN(entryTime)) continue
    trades.push({
      position_id: `BYB_${r[0]}_${entryTime.getTime()}`,
      entry_time: entryTime.toISOString(),
      symbol: String(r[1]).trim(),
      direction: String(r[2]).trim().toUpperCase() === 'BUY' ? 'Long' : 'Short',
      size: parseFloat(r[3]) || 0,
      entry_price: parseFloat(r[4]) || 0,
      pnl: parseFloat(r[6]) || 0
    })
  }
  return trades
}

// ── PARSER: GENERIC ───────────────────────────────────────────────────────────
function parseGeneric(rows) {
  const trades = []
  const hRow = rows.findIndex(r => r && r[0] === 'Position ID')
  if (hRow === -1) return trades
  for (let i = hRow + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length < 5) continue
    const entryTime = new Date(r[2])
    if (isNaN(entryTime)) continue
    trades.push({
      position_id: String(r[0]).trim(),
      entry_time: entryTime.toISOString(),
      symbol: String(r[4]).trim(),
      direction: String(r[2]).trim(),
      size: parseFloat(r[5]) || 0,
      entry_price: parseFloat(r[6]) || 0,
      pnl: parseFloat(r[9]) || 0
    })
  }
  return trades
}

// ── MAIN ROUTER ───────────────────────────────────────────────────────────────
export function parseTradeFile(rows, filename, accountIdOverride = null) {
  if (!rows || rows.length < 2) throw new Error('File empty')
  const headerStr = rows.slice(0, 5).map(r => r.join(' ')).join(' ').toLowerCase()
  let broker = 'Generic'
  let trades = []
  let detectedAccountId = accountIdOverride

  if (headerStr.includes('order id') && headerStr.includes('placed time')) {
    broker = 'PrimeXBT'; trades = parsePrimeXBT(rows)
  } else if (headerStr.includes('cloid') || headerStr.includes('coin')) {
    broker = 'Hyperliquid'; detectedAccountId = detectedAccountId || filename || `hyperliquid_${Date.now()}`; trades = parseHyperliquid(rows)
  } else if (headerStr.includes('date/time') && headerStr.includes('realized p/l')) {
    broker = 'IBKR'; detectedAccountId = detectedAccountId || 'IBKR_U11154227'; trades = parseIBKR(rows)
  } else if (headerStr.includes('direction') && headerStr.includes('size') && headerStr.includes('entry price')) {
    broker = 'Extended'; trades = parseExtended(rows)
  } else if (headerStr.includes('order id') && headerStr.includes('market')) {
    broker = 'Bybit'; trades = parseBybit(rows)
  } else {
    trades = parseGeneric(rows)
  }

  return { trades, broker, detectedAccountId, skipped: 0 }
}