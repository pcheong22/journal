// lib/tradeUtils.js
// Master router: detects broker from file, routes to correct parser
// All parsers output the same normalised trade schema

export { parseDate, getSession, getTvSymbol, normaliseSymbol, calcRMultiple, computeStreaks } from './parserUtils'
import { detectBroker }           from './parserUtils'
import { parsePrimeXBT, extractPrimeXBTMeta } from './parsers/primexbt'

// ── MASTER PARSE ENTRY POINT ─────────────────────────────────────────────────
export function parseTradeFile(rows, filename, accountIdOverride = null) {
  if (!rows || rows.length < 2) throw new Error('File appears to be empty')

  // Find first non-empty row (header)
  let hRowIdx = 0
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (rows[i] && rows[i].filter(Boolean).length > 2) { hRowIdx = i; break }
  }
  const headers = rows[hRowIdx].map(h => String(h || '').trim())
  const broker  = detectBroker(headers, filename)

  if (broker === 'PrimeXBT') {
    const { accountId, currency } = extractPrimeXBTMeta(filename)
    const finalId = accountIdOverride || accountId
    const trades  = parsePrimeXBT(rows, finalId, currency)
    // ── NORMALIZE NOTIONAL USD ACROSS ALL BROKERS ───────────────────────────────
    const normalisedTrades = trades.map(t => ({
    ...t,
    notional_usd: t.notional_usd || calculateNotionalUSD(t.size, t.entry_price, t.symbol, t.currency || 'USD')
}))
    return { broker, accountId: finalId || accountId, currency, trades: normalisedTrades }
    return { broker: 'PrimeXBT', accountId: finalId, currency, trades }
  }

  // Unknown format
  throw new Error(
    `Unrecognised file format. ` +
    `Supported: PrimeXBT orders CSV (filename: DATE_ACCOUNTID_CURRENCY_orders.csv). ` +
    `Headers found: ${headers.slice(0,6).join(', ')}`
  )
}

// ── CLIENT-SIDE STATS COMPUTATION ────────────────────────────────────────────
export function computeStats(trades) {
  if (!trades || trades.length === 0) return null

  const wins   = trades.filter(t => t.pnl > 0)
  const losses = trades.filter(t => t.pnl < 0)
  const longs  = trades.filter(t => t.direction === 'Long')
  const shorts = trades.filter(t => t.direction === 'Short')

  const grpBy  = (arr, key) => arr.reduce((acc, t) => {
    const k = t[key]; if (!acc[k]) acc[k] = []; acc[k].push(t); return acc
  }, {})
  const gs = g => ({
    count:     g.length,
    total_pnl: g.reduce((s, t) => s + t.pnl, 0),
    win_rate:  g.filter(t => t.pnl > 0).length / g.length,
    avg_pnl:   g.reduce((s, t) => s + t.pnl, 0) / g.length,
  })

  const monthG = {}, dateG = {}, hourG = {}
  trades.forEach(t => {
    const m = t.entry_time.slice(0, 7); if (!monthG[m]) monthG[m] = []; monthG[m].push(t)
    const d = t.entry_time.slice(0, 10); if (!dateG[d])  dateG[d]  = []; dateG[d].push(t)
    const h = new Date(t.entry_time).getUTCHours(); if (!hourG[h]) hourG[h] = []; hourG[h].push(t)
  })

  const buckets = { '<5min':[], '5-15min':[], '15-60min':[], '1-4hr':[], '4-24hr':[], '>24hr':[] }
  trades.forEach(t => {
    const d = t.duration_mins; if (d == null) return
    if      (d < 5)    buckets['<5min'].push(t)
    else if (d < 15)   buckets['5-15min'].push(t)
    else if (d < 60)   buckets['15-60min'].push(t)
    else if (d < 240)  buckets['1-4hr'].push(t)
    else if (d < 1440) buckets['4-24hr'].push(t)
    else               buckets['>24hr'].push(t)
  })

  const sorted = [...trades].sort((a, b) => a.entry_time.localeCompare(b.entry_time))
  let cum = 0; const cumByDate = {}
  sorted.forEach(t => { cum += t.pnl; cumByDate[t.entry_time.slice(0, 10)] = cum })

  // Streak analysis
  let curType = null, curCount = 0, maxWin = 0, maxLoss = 0, curWin = 0, curLoss = 0
  sorted.forEach(t => {
    const type = t.pnl >= 0 ? 'W' : 'L'
    if (type === curType) {
      curCount++
    } else {
      curType = type; curCount = 1
    }
    if (type === 'W') { curWin = curCount; curLoss = 0; maxWin = Math.max(maxWin, curWin) }
    else              { curLoss = curCount; curWin = 0; maxLoss = Math.max(maxLoss, curLoss) }
  })

  return {
    overview: {
      total_trades: trades.length,
      total_pnl:    trades.reduce((s, t) => s + t.pnl, 0),
      win_rate:     wins.length / trades.length,
      avg_win:      wins.length   ? wins.reduce((s, t)   => s + t.pnl, 0) / wins.length   : 0,
      avg_loss:     losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0,
      best_trade:   trades.length ? Math.max(...trades.map(t => t.pnl)) : 0,
      worst_trade:  trades.length ? Math.min(...trades.map(t => t.pnl)) : 0,
      long_pnl:     longs.reduce((s, t)  => s + t.pnl, 0),
      short_pnl:    shorts.reduce((s, t) => s + t.pnl, 0),
      long_wr:      longs.length  ? longs.filter(t  => t.pnl > 0).length / longs.length  : 0,
      short_wr:     shorts.length ? shorts.filter(t => t.pnl > 0).length / shorts.length : 0,
      long_count:   longs.length,
      short_count:  shorts.length,
      max_win_streak:  maxWin,
      max_loss_streak: maxLoss,
      current_streak:  curType ? `${curType}${curCount}` : null,
    },
    symbols:    Object.entries(grpBy(trades,'symbol')).map(([symbol,ts])        => ({ symbol, ...gs(ts) })).sort((a,b) => b.total_pnl - a.total_pnl),
    sessions:   Object.entries(grpBy(trades,'session')).map(([session,ts])      => ({ session, ...gs(ts) })),
    daily_dow:  Object.entries(grpBy(trades,'day_of_week')).map(([dow,ts])      => ({ day_of_week: dow, ...gs(ts) }))
      .sort((a,b) => { const o=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']; return o.indexOf(a.day_of_week)-o.indexOf(b.day_of_week) }),
    monthly:    Object.entries(monthG).map(([month_str,ts]) => ({ month_str, ...gs(ts) })).sort((a,b) => a.month_str.localeCompare(b.month_str)),
    calendar:   Object.entries(dateG).map(([date,ts])       => ({ date, ...gs(ts) })).sort((a,b) => a.date.localeCompare(b.date)),
    cumulative: Object.entries(cumByDate).map(([date,cum_pnl]) => ({ date, cum_pnl })).sort((a,b) => a.date.localeCompare(b.date)),
    duration:   Object.entries(buckets).map(([bucket,ts])   => ({ bucket, ...gs(ts) })),
    hourly:     Object.entries(hourG).map(([hour,ts])        => ({ hour: parseInt(hour), ...gs(ts) })).sort((a,b) => a.hour - b.hour),
    streaks:    { maxWin, maxLoss, currentType: curType, currentCount: curCount },
  }
}

// ── PNL PATH SIMULATION ───────────────────────────────────────────────────────
const VOL_MAP = {
  NASDAQ:8, SP500:3, 'HK-HSI':20, 'XAG/USD':.05, 'XAU/USD':3,
  GER30:15, EUR50:8, JAPAN:30, CRUDE:.15, 'NAT.GAS':.02, DOWJ:20,
  'EUR/USD':.0005,'USD/JPY':.05,'GBP/USD':.0007,'AUD/USD':.0004,
  'USD/CAD':.0005,'EUR/JPY':.07,'CAD/JPY':.06,
  'BTC/USD':50,'ETH/USD':5,'SOL/USD':.3,
  'BTC/USDT':50,'ETH/USDT':5,'SOL/USDT':.3,
  'BTC-USD':50,'ETH-USD':5,'SOL-USD':.3,
  'XRP/USDT':.001, USTEC:8, US30:20, US500:3, USOIL:.15,
}

export function simulatePnLPath(trade) {
  const { entry_price: ep, exit_price: xp, direction, pnl, duration_mins: dur, symbol, notional_usd } = trade
  if (!ep || !xp || !dur || dur <= 0) return { timePct:[0,100], pnlPath:[0,pnl], mae:Math.min(0,pnl), mfe:Math.max(0,pnl) }

  const nPts  = Math.max(Math.min(Math.round(dur), 200), 20)
  const diff  = xp - ep
  const pnlPt = Math.abs(diff) > 1e-10 ? pnl / diff : (notional_usd || 1e6) / ep
  const seed  = Math.abs(Math.round(ep * 100 + xp * 100 + pnl * 10)) % 1_000_000
  const rand  = s => { s = Math.sin(s) * 43758.5453123; return s - Math.floor(s) }
  const vol   = (VOL_MAP[symbol] || Math.abs(diff / (dur || 1))) * 0.9

  const W = new Array(nPts + 1).fill(0)
  for (let i = 1; i <= nPts; i++) W[i] = W[i-1] + (rand(seed + i*7.3)*2 - 1) * Math.sqrt(1/nPts)
  const Wf   = W[nPts]
  const tArr = Array.from({ length: nPts+1 }, (_, i) => i / nPts)

  const prices = tArr.map((ti, i) => {
    const bridge = W[i] - ti*Wf + ti*diff
    const noise  = (i === 0 || i === nPts) ? 0 : (rand(seed + i*13.7) - 0.5) * vol * 0.6
    return ep + bridge + noise
  })
  let path = prices.map(p => direction === 'Long' ? (p-ep)*Math.abs(pnlPt) : (ep-p)*Math.abs(pnlPt))
  path[0] = 0; path[nPts] = pnl

  const mae  = Math.min(...path), mfe = Math.max(...path)
  const step = Math.max(1, Math.floor((nPts+1) / 80))
  const sampled = [], sampledT = []
  for (let i = 0; i <= nPts; i += step) { sampled.push(Math.round(path[i])); sampledT.push(Math.round(tArr[i]*100)) }
  if (sampledT[sampledT.length-1] !== 100) { sampled.push(Math.round(pnl)); sampledT.push(100) }
  return { timePct: sampledT, pnlPath: sampled, mae, mfe }
}
