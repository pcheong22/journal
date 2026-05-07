// Broker Direction → True Direction mapping
// Broker "Sell" = closing a LONG position (opened by buying, closed by selling)
// Broker "Buy" = closing a SHORT position (opened by selling, closed by buying)
export const DIRECTION_MAP = { Sell: 'Long', Buy: 'Short' }

// TradingView symbol mapping
export const TV_SYMBOL_MAP = {
  NASDAQ: 'CAPITALCOM:US100',
  SP500: 'CAPITALCOM:US500',
  'HK-HSI': 'HKEX:HSI',
  SILVER: 'OANDA:XAGUSD',
  'XAG/USD': 'OANDA:XAGUSD',
  GOLD: 'OANDA:XAUUSD',
  'XAU/USD': 'OANDA:XAUUSD',
  GER30: 'OANDA:DE30EUR',
  EUR50: 'OANDA:EU50EUR',
  JAPAN: 'OANDA:JP225USD',
  CRUDE: 'NYMEX:CL1!',
  'NAT.GAS': 'NYMEX:NG1!',
  'EUR/USD': 'FX:EURUSD',
  'USD/JPY': 'FX:USDJPY',
  'GBP/USD': 'FX:GBPUSD',
  'AUD/USD': 'FX:AUDUSD',
  'USD/CAD': 'FX:USDCAD',
  'EUR/JPY': 'FX:EURJPY',
  'CAD/JPY': 'FX:CADJPY',
  'BTC/USD': 'BINANCE:BTCUSDT',
  'ETH/USD': 'BINANCE:ETHUSDT',
  'SOL/USD': 'BINANCE:SOLUSDT',
  DOWJ: 'CAPITALCOM:US30',
}

export function getSession(hour) {
  if (hour >= 23 || hour < 7) return 'Asia'
  if (hour >= 7 && hour < 12) return 'London'
  if (hour >= 12 && hour < 16) return 'London/NY Overlap'
  if (hour >= 16 && hour < 22) return 'New York'
  return 'Other'
}

export function parseExcelRows(rows) {
  // Find header row
  let headerRow = -1
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const joined = (rows[i] || []).join('|').toLowerCase()
    if (joined.includes('position') || joined.includes('direction') || joined.includes('profit')) {
      headerRow = i
      break
    }
  }
  if (headerRow < 0) throw new Error('Could not find header row in uploaded file')

  const headers = rows[headerRow].map(h => String(h || '').trim().toLowerCase().replace(/\s+/g, ' '))
  const col = names => {
    for (const n of names) {
      const i = headers.findIndex(h => h.includes(n))
      if (i >= 0) return i
    }
    return -1
  }

  const iPos = col(['position id', 'position'])
  const iDir = col(['direction'])
  const iEntry = col(['entry time', 'entry'])
  const iExit = col(['exit', 'transfer time'])
  const iSym = col(['symbol'])
  const iSize = col(['size'])
  const iEP = col(['entry price'])
  const iXP = col(['exit price'])
  const iPnl = col(['profit', 'p&l', 'pnl'])
  const iNotional = col(['notional'])

  const trades = []
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length === 0) continue
    const rawDir = String(r[iDir] || '')
    if (!rawDir || !['buy', 'sell'].includes(rawDir.toLowerCase())) continue
    const posId = r[iPos]
    if (!posId || String(posId).trim() === '') continue

    const rawPnl = iPnl >= 0 ? parseFloat(r[iPnl]) : NaN
    if (isNaN(rawPnl)) continue

    const entryStr = iEntry >= 0 ? r[iEntry] : null
    const exitStr = iExit >= 0 ? r[iExit] : null
    const entryTime = entryStr ? new Date(entryStr) : null
    const exitTime = exitStr ? new Date(exitStr) : null

    if (!entryTime || isNaN(entryTime.getTime())) continue

    const ep = iEP >= 0 ? parseFloat(r[iEP]) : null
    const xp = iXP >= 0 ? parseFloat(r[iXP]) : null
    const size = iSize >= 0 ? parseFloat(r[iSize]) : null
    const notional = iNotional >= 0 ? Math.abs(parseFloat(r[iNotional])) : null
    const sym = iSym >= 0 ? String(r[iSym] || '').trim() : ''
    const dir = DIRECTION_MAP[rawDir] || rawDir
    const durationMins = exitTime ? (exitTime - entryTime) / 60000 : null
    const hour = entryTime.getUTCHours()
    const pctGain = notional && notional > 0 ? (rawPnl / notional) * 100 : null

    trades.push({
      position_id: String(posId).trim(),
      entry_time: entryTime.toISOString(),
      exit_time: exitTime ? exitTime.toISOString() : null,
      symbol: sym,
      direction: dir,
      size: size != null && !isNaN(size) ? Math.abs(size) : null,
      entry_price: ep != null && !isNaN(ep) ? ep : null,
      exit_price: xp != null && !isNaN(xp) ? xp : null,
      notional_usd: notional != null && !isNaN(notional) ? notional : null,
      pnl: rawPnl,
      pct_gain: pctGain != null && !isNaN(pctGain) && isFinite(pctGain) ? pctGain : null,
      duration_mins: durationMins,
      session: getSession(hour),
      day_of_week: entryTime.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
      tv_symbol: TV_SYMBOL_MAP[sym] || sym,
      raw_direction: rawDir,
    })
  }
  return trades
}

export function computeStats(trades) {
  if (!trades || trades.length === 0) return null
  const wins = trades.filter(t => t.pnl > 0)
  const losses = trades.filter(t => t.pnl < 0)
  const longs = trades.filter(t => t.direction === 'Long')
  const shorts = trades.filter(t => t.direction === 'Short')

  const groupBy = (arr, key) => arr.reduce((acc, t) => {
    const k = t[key]; if (!acc[k]) acc[k] = []; acc[k].push(t); return acc
  }, {})

  const symGroups = groupBy(trades, 'symbol')
  const sesGroups = groupBy(trades, 'session')
  const dowGroups = groupBy(trades, 'day_of_week')
  const monthGroups = {}
  trades.forEach(t => {
    const m = t.entry_time.slice(0, 7)
    if (!monthGroups[m]) monthGroups[m] = []
    monthGroups[m].push(t)
  })
  const dateGroups = {}
  trades.forEach(t => {
    const d = t.entry_time.slice(0, 10)
    if (!dateGroups[d]) dateGroups[d] = []
    dateGroups[d].push(t)
  })
  const hourGroups = {}
  trades.forEach(t => {
    const h = new Date(t.entry_time).getUTCHours()
    if (!hourGroups[h]) hourGroups[h] = []
    hourGroups[h].push(t)
  })

  const grpStats = grp => ({
    count: grp.length,
    total_pnl: grp.reduce((s, t) => s + t.pnl, 0),
    win_rate: grp.filter(t => t.pnl > 0).length / grp.length,
    avg_pnl: grp.reduce((s, t) => s + t.pnl, 0) / grp.length,
  })

  // Cumulative PnL by date
  const sortedTrades = [...trades].sort((a, b) => a.entry_time.localeCompare(b.entry_time))
  let cum = 0
  const cumulativeByDate = {}
  sortedTrades.forEach(t => {
    cum += t.pnl
    cumulativeByDate[t.entry_time.slice(0, 10)] = cum
  })

  // Duration buckets
  const buckets = { '<5min': [], '5-15min': [], '15-60min': [], '1-4hr': [], '4-24hr': [], '>24hr': [] }
  trades.forEach(t => {
    const d = t.duration_mins
    if (d == null) return
    if (d < 5) buckets['<5min'].push(t)
    else if (d < 15) buckets['5-15min'].push(t)
    else if (d < 60) buckets['15-60min'].push(t)
    else if (d < 240) buckets['1-4hr'].push(t)
    else if (d < 1440) buckets['4-24hr'].push(t)
    else buckets['>24hr'].push(t)
  })

  return {
    overview: {
      total_trades: trades.length,
      total_pnl: trades.reduce((s, t) => s + t.pnl, 0),
      win_rate: wins.length / trades.length,
      avg_win: wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0,
      avg_loss: losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0,
      best_trade: Math.max(...trades.map(t => t.pnl)),
      worst_trade: Math.min(...trades.map(t => t.pnl)),
      long_pnl: longs.reduce((s, t) => s + t.pnl, 0),
      short_pnl: shorts.reduce((s, t) => s + t.pnl, 0),
      long_wr: longs.length ? longs.filter(t => t.pnl > 0).length / longs.length : 0,
      short_wr: shorts.length ? shorts.filter(t => t.pnl > 0).length / shorts.length : 0,
      long_count: longs.length,
      short_count: shorts.length,
    },
    symbols: Object.entries(symGroups).map(([symbol, ts]) => ({ symbol, ...grpStats(ts) }))
      .sort((a, b) => b.total_pnl - a.total_pnl),
    sessions: Object.entries(sesGroups).map(([session, ts]) => ({ session, ...grpStats(ts) })),
    daily_dow: Object.entries(dowGroups).map(([dow, ts]) => ({ day_of_week: dow, ...grpStats(ts) }))
      .sort((a, b) => {
        const order = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
        return order.indexOf(a.day_of_week) - order.indexOf(b.day_of_week)
      }),
    monthly: Object.entries(monthGroups).map(([month_str, ts]) => ({
      month_str, ...grpStats(ts)
    })).sort((a, b) => a.month_str.localeCompare(b.month_str)),
    calendar: Object.entries(dateGroups).map(([date, ts]) => ({
      date, ...grpStats(ts)
    })).sort((a, b) => a.date.localeCompare(b.date)),
    cumulative: Object.entries(cumulativeByDate).map(([date, cum_pnl]) => ({ date, cum_pnl }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    duration: Object.entries(buckets).map(([bucket, ts]) => ({
      bucket, ...grpStats(ts)
    })),
    hourly: Object.entries(hourGroups).map(([hour, ts]) => ({
      hour: parseInt(hour), ...grpStats(ts)
    })).sort((a, b) => a.hour - b.hour),
  }
}

export function simulatePnLPath(trade) {
  const { entry_price: ep, exit_price: xp, direction, pnl, duration_mins: dur, symbol, notional_usd } = trade
  if (!ep || !xp || !dur || dur <= 0) return { timePct: [0, 100], pnlPath: [0, pnl], mae: Math.min(0, pnl), mfe: Math.max(0, pnl) }

  const nPts = Math.max(Math.min(Math.round(dur), 200), 20)
  const priceDiff = xp - ep
  const pnlPerPt = Math.abs(priceDiff) > 1e-10 ? pnl / priceDiff : (notional_usd || 1e6) / ep

  const seed = Math.abs(Math.round(ep * 100 + xp * 100 + pnl * 10)) % 1000000
  const rand = s => { s = Math.sin(s) * 43758.5453123; return s - Math.floor(s) }

  const volMap = { NASDAQ:8,SP500:3,'HK-HSI':20,SILVER:.05,'XAG/USD':.05,GOLD:3,'XAU/USD':3,GER30:15,EUR50:8,JAPAN:30,CRUDE:.15,'NAT.GAS':.02,'EUR/USD':.0005,'USD/JPY':.05,'GBP/USD':.0007,'AUD/USD':.0004,'USD/CAD':.0005,'EUR/JPY':.07,'CAD/JPY':.06,'BTC/USD':50,'ETH/USD':5,'SOL/USD':.3,DOWJ:20 }
  const vol = (volMap[symbol] || Math.abs(priceDiff / (dur || 1))) * 0.9

  const W = new Array(nPts + 1).fill(0)
  for (let i = 1; i <= nPts; i++) W[i] = W[i - 1] + (rand(seed + i * 7.3) * 2 - 1) * Math.sqrt(1 / nPts)
  const Wf = W[nPts]
  const tArr = Array.from({ length: nPts + 1 }, (_, i) => i / nPts)
  const prices = tArr.map((ti, i) => {
    const bridge = W[i] - ti * Wf + ti * priceDiff
    const noise = i === 0 || i === nPts ? 0 : (rand(seed + i * 13.7) - 0.5) * vol * 0.6
    return ep + bridge + noise
  })
  let path = prices.map(p => direction === 'Long' ? (p - ep) * Math.abs(pnlPerPt) : (ep - p) * Math.abs(pnlPerPt))
  path[0] = 0; path[nPts] = pnl

  const mae = Math.min(...path)
  const mfe = Math.max(...path)
  const step = Math.max(1, Math.floor((nPts + 1) / 80))
  const sampled = []; const sampledT = []
  for (let i = 0; i <= nPts; i += step) { sampled.push(Math.round(path[i])); sampledT.push(Math.round(tArr[i] * 100)) }
  if (sampledT[sampledT.length - 1] !== 100) { sampled.push(Math.round(pnl)); sampledT.push(100) }

  return { timePct: sampledT, pnlPath: sampled, mae, mfe }
}
