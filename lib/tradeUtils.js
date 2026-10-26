// lib/tradeUtils.js
// Master router: detects broker from file, routes to correct parser
// All parsers output the same normalised trade schema

export { parseDate, getSession, getTvSymbol, normaliseSymbol, calcRMultiple, computeStreaks } from './parserUtils'
import { detectBroker }           from './parserUtils'
import { parsePrimeXBT, extractPrimeXBTMeta } from './parsers/primexbt'
import { parseIBKR }              from './parsers/ibkr'
import { parseExtended }          from './parsers/extended'
import { parseHyperliquid, isHyperliquid } from './parsers/hyperliquid'
import { parseTxFlow, isTxFlow } from './parsers/txflow'
import { parseBybitPerp, isBybitPerp, parseBybitSpot, isBybitSpot } from './parsers/bybit'

// ── MASTER PARSE ENTRY POINT ─────────────────────────────────────────────────
export function parseTradeFile(rows, filename, accountIdOverride = null, timezone = null) {
  if (!rows || rows.length < 2) throw new Error('File appears to be empty')
  if (isTxFlow(rows)) return parseTxFlow(rows, filename, accountIdOverride, timezone)

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
    const { accountId, currency, legacyAccountId } = extractPrimeXBTMeta(filename)
    const finalId = accountIdOverride || accountId
    if (!finalId) throw new Error('Choose the PrimeXBT account before importing this filename.')
    const trades  = parsePrimeXBT(rows, finalId, currency || 'USDC')
    return { broker: 'PrimeXBT', accountId: finalId, sourceAccountId:accountId, legacyAccountId, currency:currency || 'USDC', trades }
  }

  // Unknown format
  throw new Error(
    `Unrecognised file format. ` +
    `Supported: PrimeXBT, IBKR, Hyperliquid, Hypurrscan, TxFlow, Bybit and Extended CSVs. ` +
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
    const type = t.pnl > 0 ? 'W' : t.pnl < 0 ? 'L' : 'B'
    if(type==='B'){curType='B';curCount=0;curWin=0;curLoss=0;return}
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

  // ── Drawdown events ─────────────────────────────────────────────────────────
  // Identify distinct drawdown periods: peak → trough → recovery
  // A new drawdown starts when cumPnl falls below the previous peak.
  // It ends when cumPnl recovers back to or above that peak.
  const drawdownEvents = []
  {
    let runPeak = 0, runPeakDate = null
    let inDD = false, ddStart = null, ddStartDate = null, ddTrough = 0, ddTroughDate = null
    let ddPeakVal = 0

    sorted.forEach(t => {
      const ts  = t.exit_time || t.entry_time
      const cum = (() => { let c = 0; return (_t) => { c += _t.pnl; return c } })

      // We need running cumPnl — recompute inline
    })

    // Recompute with proper running state
    let cum2 = 0
    sorted.forEach((t, i) => {
      cum2 += t.pnl
      const ts = (t.exit_time || t.entry_time || '').slice(0, 10)

      if (cum2 > runPeak) {
        // New peak — if we were in a drawdown, record recovery
        if (inDD && ddTrough < ddPeakVal) {
          drawdownEvents.push({
            peak_date:     ddStartDate,
            trough_date:   ddTroughDate,
            recovery_date: ts,
            peak_val:      ddPeakVal,
            trough_val:    ddTrough,
            depth:         ddPeakVal - ddTrough,
            duration_days: ddStartDate && ddTroughDate
              ? Math.round((new Date(ddTroughDate) - new Date(ddStartDate)) / 86400000)
              : null,
            recovery_days: ddTroughDate && ts
              ? Math.round((new Date(ts) - new Date(ddTroughDate)) / 86400000)
              : null,
          })
        }
        runPeak = cum2; runPeakDate = ts; inDD = false
        ddPeakVal = cum2; ddStartDate = ts; ddTrough = cum2; ddTroughDate = ts
      } else if (cum2 < runPeak) {
        if (!inDD) {
          inDD = true
          ddPeakVal = runPeak; ddStartDate = runPeakDate
          ddTrough = cum2; ddTroughDate = ts
        } else if (cum2 < ddTrough) {
          ddTrough = cum2; ddTroughDate = ts
        }
      }
    })

    // Capture open drawdown (not yet recovered)
    if (inDD && ddTrough < ddPeakVal) {
      drawdownEvents.push({
        peak_date:     ddStartDate,
        trough_date:   ddTroughDate,
        recovery_date: null, // still in drawdown
        peak_val:      ddPeakVal,
        trough_val:    ddTrough,
        depth:         ddPeakVal - ddTrough,
        duration_days: ddStartDate && ddTroughDate
          ? Math.round((new Date(ddTroughDate) - new Date(ddStartDate)) / 86400000)
          : null,
        recovery_days: null,
      })
    }
  }

  const totalPnl=trades.reduce((sum,t)=>sum+t.pnl,0)
  // Portfolio risk ratios require an equity series and external cash flows.
  const calmar=null,sharpe=null,sortino=null
  // Profit Factor
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss   = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const profitFactor = grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : null

  // Recovery Factor = Net P&L / Max Drawdown
  const recoveryFactor = maxDrawdown > 0
    ? Math.round((totalPnl / maxDrawdown) * 100) / 100
    : null

  const kellyFull=null,kellyHalf=null,rorHalf=null,rorRuin=null,ulcerIndex=null
  return {
    overview: {
      total_trades: trades.length,
      breakeven_count: trades.filter(t=>t.pnl===0).length,
      winning_count: wins.length, losing_count: losses.length,
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
    cumulative:       Object.entries(cumByDate).map(([date,cum_pnl]) => ({ date, cum_pnl })).sort((a,b) => a.date.localeCompare(b.date)),
    drawdown_events:  drawdownEvents.sort((a,b) => b.depth - a.depth),
    duration:   Object.entries(buckets).map(([bucket,ts])   => ({ bucket, ...gs(ts) })),
    hourly:     Object.entries(hourG).map(([hour,ts])        => ({ hour: parseInt(hour), ...gs(ts) })).sort((a,b) => a.hour - b.hour),
    streaks:    { maxWin, maxLoss, currentType: curType, currentCount: curCount },
  }
}

// Intratrade excursions are unavailable without observed market-price history.
export function simulatePnLPath() {return null}
