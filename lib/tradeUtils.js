// lib/tradeUtils.js
// Master router: detects broker from file, routes to correct parser
// All parsers output the same normalised trade schema

export { parseDate, getSession, getTvSymbol, normaliseSymbol, calcRMultiple, computeStreaks } from './parserUtils'
import { detectBroker }           from './parserUtils'
import { parsePrimeXBT, extractPrimeXBTMeta } from './parsers/primexbt'
import { parseIBKR }              from './parsers/ibkr'
import { parseExtended }          from './parsers/extended'
import { parseHyperliquid, isHyperliquid } from './parsers/hyperliquid'
import { parseBybitPerp, isBybitPerp, parseBybitSpot, isBybitSpot } from './parsers/bybit'

// ── MASTER PARSE ENTRY POINT ─────────────────────────────────────────────────
export function parseTradeFile(rows, filename, accountIdOverride = null, timezone = null) {
  if (!rows || rows.length < 2) throw new Error('File appears to be empty')

  // Detect IBKR by characteristic first-column value
  const isIBKR = rows.slice(0, 5).some(r => r[0] === 'Statement' && r[2] === 'BrokerName')
  if (isIBKR) return parseIBKR(rows, filename, accountIdOverride)

  // Detect Bybit Spot
  if (isBybitPerp(rows)) return parseBybitPerp(rows, filename, accountIdOverride || 'BYBIT_PERP')
  if (isBybitSpot(rows)) return parseBybitSpot(rows, filename, accountIdOverride || 'BYBIT_SPOT')

  // Detect Hyperliquid
  if (isHyperliquid(rows)) return parseHyperliquid(rows, filename, accountIdOverride || 'HL_DEFAULT', timezone)

  // Detect Extended by header columns
  const isExtended = rows.slice(0, 5).some(r =>
    r[0] === 'market' && r[1] === 'side' && r.includes('realised_pnl')
  )
  if (isExtended) return parseExtended(rows, filename, accountIdOverride)

  // Find first non-empty row (header) for column-based detection
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
    return { broker: 'PrimeXBT', accountId: finalId, currency, trades }
  }

  // Unknown format
  throw new Error(
    `Unrecognised file format. ` +
    `Supported: PrimeXBT orders CSV, IBKR Activity Statement, Extended realized_pnl.csv. ` +
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
    const ts = t.exit_time || t.entry_time  // exit_time = realised P&L date
    if (!ts) return
    const m = ts.slice(0, 7); if (!monthG[m]) monthG[m] = []; monthG[m].push(t)
    const d = ts.slice(0, 10); if (!dateG[d])  dateG[d]  = []; dateG[d].push(t)
    const h = new Date(ts).getUTCHours(); if (!hourG[h]) hourG[h] = []; hourG[h].push(t)
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

  // Sort by exit_time (realised date) — same as how the API orders and filters.
  // Falling back to entry_time only if exit_time is missing.
  // This ensures the equity curve is plotted at the date P&L was realised,
  // not the entry date (which can be in a prior period for multi-day trades).
  const sorted = [...trades].sort((a, b) => {
    const ta = a.exit_time || a.entry_time || ''
    const tb = b.exit_time || b.entry_time || ''
    return ta.localeCompare(tb)
  })

  let cum = 0; const cumByDate = {}
  sorted.forEach(t => {
    const ts = t.exit_time || t.entry_time  // plot at realised date, not entry date
    if (!ts) return
    cum += t.pnl
    cumByDate[ts.slice(0, 10)] = cum
  })

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

  // ── Max drawdown + Calmar ─────────────────────────────────────────────────
  let peak = 0, maxDrawdown = 0, cumPnl = 0
  sorted.forEach(t => {
    cumPnl += t.pnl
    if (cumPnl > peak) peak = cumPnl
    const dd = peak - cumPnl
    if (dd > maxDrawdown) maxDrawdown = dd
  })

  // Calmar = Annualised P&L ($) / Max Drawdown ($)
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0)
  let calmar = null
  if (maxDrawdown > 0 && sorted.length >= 20) {
    const firstTs = sorted[0].exit_time  || sorted[0].entry_time
    const lastTs  = sorted[sorted.length-1].exit_time || sorted[sorted.length-1].entry_time
    if (firstTs && lastTs) {
      const calDays    = Math.max(1, (new Date(lastTs) - new Date(firstTs)) / (1000*60*60*24))
      const annualised = totalPnl * (365 / calDays)
      calmar           = annualised / maxDrawdown
    }
  }

  // ── Risk Ratios ─────────────────────────────────────────────────────────────
  // Sharpe & Sortino: use return on deployed notional per trade (not account equity)
  // This avoids needing a static account size for leveraged trading.
  // Risk-free rate: 4.5% annual = 4.5/365 per calendar day
  const RISK_FREE_ANNUAL = 0.045

  // Build array of per-trade returns on notional
  const tradeReturns = sorted
    .filter(t => t.notional_usd && t.notional_usd > 0 && t.pnl != null)
    .map(t => t.pnl / t.notional_usd)

  let sharpe = null, sortino = null
  if (tradeReturns.length >= 20) {
    const n      = tradeReturns.length
    const mean   = tradeReturns.reduce((s, r) => s + r, 0) / n
    const rfDaily = RISK_FREE_ANNUAL / 365

    // Estimate avg calendar days per trade for rf adjustment
    const calDaysSpan = sorted.length >= 2
      ? Math.max(1, (new Date(sorted[sorted.length-1].exit_time || sorted[sorted.length-1].entry_time)
          - new Date(sorted[0].exit_time || sorted[0].entry_time)) / (1000*60*60*24))
      : 365
    const rfPerTrade = rfDaily * (calDaysSpan / sorted.length)

    const excessReturns = tradeReturns.map(r => r - rfPerTrade)
    const excessMean    = excessReturns.reduce((s, r) => s + r, 0) / n

    // Std dev of all returns (Sharpe)
    const variance = excessReturns.reduce((s, r) => s + (r - excessMean) ** 2, 0) / (n - 1)
    const stdDev   = Math.sqrt(variance)
    if (stdDev > 0) sharpe = Math.round((excessMean / stdDev) * Math.sqrt(n) * 100) / 100

    // Downside std dev only (Sortino)
    const downside = excessReturns.filter(r => r < 0)
    if (downside.length >= 5) {
      const dVar   = downside.reduce((s, r) => s + r ** 2, 0) / (n - 1)
      const dStdDev = Math.sqrt(dVar)
      if (dStdDev > 0) sortino = Math.round((excessMean / dStdDev) * Math.sqrt(n) * 100) / 100
    }
  }

  // Profit Factor
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss   = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const profitFactor = grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : null

  // Recovery Factor = Net P&L / Max Drawdown
  const recoveryFactor = maxDrawdown > 0
    ? Math.round((totalPnl / maxDrawdown) * 100) / 100
    : null

  // Kelly Fraction = W - (1-W)/R  where W=win rate, R=avg win / avg loss ratio
  const winRate  = wins.length / trades.length
  const avgWin   = wins.length   ? wins.reduce((s, t)   => s + t.pnl, 0) / wins.length   : 0
  const avgLoss  = losses.length ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0
  const kellyFull = avgLoss > 0
    ? Math.round((winRate - (1 - winRate) / (avgWin / avgLoss)) * 10000) / 100 // as %
    : null
  const kellyHalf = kellyFull != null ? Math.round(kellyFull / 2 * 100) / 100 : null

  // Risk of Ruin (percentage-based, no account size needed)
  // P(ruin) ≈ ((1-edge)/(1+edge))^N where edge = expectancy / avg_abs_trade
  // Using simplified formula: ror = ((1-W)/(W))^(1/R) capped at 0-100%
  let rorHalf = null, rorRuin = null
  if (avgLoss > 0 && avgWin > 0 && winRate > 0 && winRate < 1) {
    const R   = avgWin / avgLoss
    const W   = winRate
    // Probability of 30% drawdown from any peak
    const q   = (1 - W) / W
    const rorBase = Math.pow(q, R)
    rorHalf  = Math.round(Math.min(99, rorBase * 100 * 2) * 10) / 10  // P(30% dd) approx
    rorRuin  = Math.round(Math.min(99, rorBase * 100 * 0.3) * 10) / 10 // P(total ruin) approx
  }

  // Ulcer Index = sqrt(mean of squared drawdown percentages from peak)
  // Using P&L curve (dollar-based since we lack % returns)
  let ulcerIndex = null
  if (sorted.length >= 10 && peak > 0) {
    let uc = 0, cumU = 0
    sorted.forEach(t => {
      cumU += t.pnl
      const dd = Math.max(0, peak - cumU)  // drawdown from running peak... recompute properly
    })
    // Recompute properly with running peak
    let runPeak = 0, runCum = 0, sumSqDd = 0
    sorted.forEach(t => {
      runCum += t.pnl
      if (runCum > runPeak) runPeak = runCum
      const dd = runPeak > 0 ? (runPeak - runCum) / runPeak * 100 : 0
      sumSqDd += dd * dd
    })
    ulcerIndex = Math.round(Math.sqrt(sumSqDd / sorted.length) * 100) / 100
  }

  return {
    overview: {
      total_trades: trades.length,
      total_pnl:    totalPnl,
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
      max_drawdown:    maxDrawdown,
      calmar,
      sharpe,
      sortino,
      profit_factor:    profitFactor,
      recovery_factor:  recoveryFactor,
      kelly_full:       kellyFull,
      kelly_half:       kellyHalf,
      ror_half:         rorHalf,
      ror_ruin:         rorRuin,
      ulcer_index:      ulcerIndex,
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
