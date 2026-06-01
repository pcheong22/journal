// lib/parsers/hyperliquid.js
// Supports two Hyperliquid CSV formats:
// 1. Native export (trade.hyperliquid.xyz): time,coin,dir,px,sz,ntl,fee,closedPnl
//    - Date: "06/01/2025 - 17:38:42" (DD/MM/YYYY)
//    - Directions: Buy/Sell (spot) or Open Long/Close Long/Open Short/Close Short (perp)
// 2. Third-party (hypedexer): time,coin,dir,px,sz,ntl,fee,feeToken,closedPnl,hash
//    - Date: "2025-01-06 13:25:38.148000" (ISO)
//    - Directions: Buy/Sell/Close Long/Close Short

import { getSession, getTvSymbol, normaliseSymbol, calculateNotionalUSD } from '../parserUtils'

const HL_SYMBOL_MAP = {
  '@107': 'HYPE', '@1': 'BTC', '@2': 'ETH', '@3': 'SOL',
  '@4': 'BNB', '@5': 'MATIC', '@6': 'ARB', '@7': 'OP',
  '@8': 'DOGE', '@9': 'AVAX', '@10': 'LTC',
}

function normaliseHLSymbol(coin) {
  if (!coin) return coin
  const mapped = HL_SYMBOL_MAP[coin]
  if (mapped) return normaliseSymbol(mapped)
  // "COPPER (xyz)" → "COPPER", "HYPE/USDC" → "HYPE/USDC", "xyz:COPPER" → "COPPER"
  const cleaned = coin.replace(/\s*\(.*?\)/g, '').replace(/^[a-z]+:/, '').trim()
  return normaliseSymbol(cleaned)
}

function parseHLDate(s) {
  s = String(s || '').trim()
  // Native format: "06/01/2025 - 17:38:42" (DD/MM/YYYY)
  const native = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2}:\d{2}:\d{2})/)
  if (native) return new Date(`${native[3]}-${native[2]}-${native[1]}T${native[4]}Z`)
  // ISO format: "2025-01-06 13:25:38.148000"
  return new Date(s.replace(' ', 'T').replace(/(\.\d+)?$/, 'Z'))
}

function isClosing(dir) {
  return dir === 'Close Long' || dir === 'Close Short' || dir === 'Sell'
}
function isOpening(dir) {
  return dir === 'Open Long' || dir === 'Open Short' || dir === 'Buy'
}
function directionFromClose(dir, pnl) {
  if (dir === 'Close Long') return 'Long'
  if (dir === 'Close Short') return 'Short'
  // For Sell/Buy: Sell closes a Long, Buy closes a Short
  if (dir === 'Sell') return 'Long'
  if (dir === 'Buy') return 'Short'
  return pnl >= 0 ? 'Long' : 'Long' // fallback
}
function openSideFor(direction) {
  return direction === 'Long' ? ['Buy', 'Open Long'] : ['Sell', 'Open Short']
}

export function parseHyperliquid(rows, filename, accountId) {
  const currency = 'USDC'

  const headerIdx = rows.findIndex(r => r[0] === 'time' && r[1] === 'coin')
  if (headerIdx < 0) return { broker:'Hyperliquid', accountId, currency, trades:[] }

  const header     = rows[headerIdx]
  const hasHash    = header.includes('hash')
  const col        = name => header.indexOf(name)

  const iTime      = col('time')
  const iCoin      = col('coin')
  const iDir       = col('dir')
  const iPx        = col('px')
  const iSz        = col('sz')
  const iFee       = col('fee')
  const iClosedPnl = col('closedPnl')
  const iHash      = hasHash ? col('hash') : -1

  const parseNum = s => { const n = parseFloat(String(s||'').replace(/,/g,'')); return isNaN(n)?null:n }

  const dataRows = rows.slice(headerIdx+1).filter(r => r.length > 3 && r[iTime])

  const opens  = []
  const closes = []

  dataRows.forEach(r => {
    const dir  = String(r[iDir]||'').trim()
    const time = parseHLDate(r[iTime])
    if (isNaN(time)) return
    const pnl = parseNum(r[iClosedPnl]) || 0
    const fill = {
      time, dir, pnl,
      coin: String(r[iCoin]||'').trim(),
      px:   parseNum(r[iPx]),
      sz:   parseNum(r[iSz]),
      fee:  parseNum(r[iFee]) || 0,
      hash: iHash >= 0 ? String(r[iHash]||'').trim() : null,
    }
    if (isClosing(dir)) closes.push(fill)
    else if (isOpening(dir)) opens.push(fill)
  })

  // ── Group closing fills ──────────────────────────────────────────────────
  // If hash available: group by hash
  // If no hash: group by coin + dir + time proximity (within 10 seconds)
  const HASH_WINDOW_MS = 10 * 1000

  const closeGroups = []
  const usedCloseIdxs = new Set()

  for (let i = 0; i < closes.length; i++) {
    if (usedCloseIdxs.has(i)) continue
    const c = closes[i]
    let group = [c]; usedCloseIdxs.add(i)

    if (c.hash) {
      // Group by same hash
      for (let j = i+1; j < closes.length; j++) {
        if (!usedCloseIdxs.has(j) && closes[j].hash === c.hash) {
          group.push(closes[j]); usedCloseIdxs.add(j)
        }
      }
    } else {
      // Group by coin + dir + time proximity
      for (let j = i+1; j < closes.length; j++) {
        if (!usedCloseIdxs.has(j) &&
            closes[j].coin === c.coin &&
            closes[j].dir  === c.dir  &&
            Math.abs(closes[j].time - c.time) <= HASH_WINDOW_MS) {
          group.push(closes[j]); usedCloseIdxs.add(j)
        }
      }
    }
    closeGroups.push(group)
  }

  // ── Build close events (one per group) ──────────────────────────────────
  const closeEvents = closeGroups.map(group => {
    group.sort((a,b) => a.time - b.time)
    let totalSz=0, weightedPx=0, totalPnl=0, totalFee=0
    group.forEach(f => {
      const sz = f.sz||0
      weightedPx += (f.px||0)*sz; totalSz+=sz
      totalPnl+=f.pnl; totalFee+=Math.abs(f.fee||0)
    })
    return {
      coin: group[0].coin, dir: group[0].dir,
      time: group[group.length-1].time,
      exitPrice: totalSz>0 ? weightedPx/totalSz : null,
      size: totalSz, pnl: Math.round(totalPnl*100)/100,
      fee: Math.round(totalFee*100)/100,
    }
  })

  // ── Consolidate close events by tracking running position size ─────────────
  closeEvents.sort((a, b) => a.time - b.time)
  opens.sort((a, b) => a.time - b.time)

  // ── Running net position approach ───────────────────────────────────────
  const tradeGroups = []

  const allEventsByCoinDir = {}

  opens.forEach((o, i) => {
    const dir = o.dir === 'Open Long' || o.dir === 'Buy' ? 'Long' : 'Short'
    const key = `${o.coin}|${dir}`
    if (!allEventsByCoinDir[key]) allEventsByCoinDir[key] = []
    allEventsByCoinDir[key].push({ type:'open', time:o.time, sz:o.sz||0, px:o.px, fill:o, idx:i })
  })

  closeEvents.forEach((ev, i) => {
    const dir = directionFromClose(ev.dir, ev.pnl)
    const key = `${ev.coin}|${dir}`
    if (!allEventsByCoinDir[key]) allEventsByCoinDir[key] = []
    allEventsByCoinDir[key].push({ type:'close', time:ev.time, sz:ev.size||0, ev, idx:i })
  })

  Object.entries(allEventsByCoinDir).forEach(([key, events]) => {
    events.sort((a, b) => a.time - b.time)
    let netPos    = 0
    let curOpens  = []
    let curCloses = []

    events.forEach(evt => {
      if (evt.type === 'open') {
        netPos += evt.sz
        curOpens.push(evt)
      } else {
        netPos -= evt.sz
        curCloses.push(evt)
      }
      // Position fully flat → emit completed trade
      if (curCloses.length > 0 && Math.abs(netPos) < 0.001) {
        tradeGroups.push({ opens:[...curOpens], closes:[...curCloses] })
        curOpens = []; curCloses = []; netPos = 0
      }
    })

    // ── Orphan handling ──────────────────────────────────────────────────
    // net < 0 means closes exceed opens in this file — the opening rows were
    // in a previous upload already in the database (truncated CSV export).
    // Emit each remaining close event as a standalone trade using its closedPnl.
    // entry_time and entry_price will be null (unknown from this file alone).
    if (netPos < -0.001 && curCloses.length > 0) {
      curCloses.forEach(c => {
        tradeGroups.push({ opens: [], closes: [c], orphan: true })
      })
      curOpens = []; curCloses = []; netPos = 0
    }
    // net > 0: more opens than closes — position still open, emit partial
    else if (curCloses.length > 0) {
      tradeGroups.push({ opens:[...curOpens], closes:[...curCloses] })
    }
  })

  const trades = []

  tradeGroups.forEach((group, gi) => {
    const { opens: gOpens, closes: gCloses, orphan } = group
    if (!gCloses.length) return

    const repClose  = gCloses[0]
    const coin      = repClose.ev.coin
    const direction = directionFromClose(repClose.ev.dir, repClose.ev.pnl)

    // Weighted avg exit + totals from closes
    let totalCloseSz=0, wExitPx=0, totalPnl=0, totalFee=0
    gCloses.forEach(c => {
      wExitPx      += (c.ev.exitPrice||0) * c.ev.size
      totalCloseSz += c.ev.size
      totalPnl     += c.ev.pnl
      totalFee     += c.ev.fee
    })
    const exitPrice = totalCloseSz > 0 ? wExitPx/totalCloseSz : null
    const pnlUsd    = Math.round(totalPnl*100)/100
    const fee       = Math.round(totalFee*100)/100
    const exitTime  = gCloses[gCloses.length-1].ev.time

    // Weighted avg entry from opens.
    // Orphan trades (closes with no matching opens in this file) have unknown
    // entry — the open was in a previous upload. Leave entry null.
    let totalOpenSz=0, wEntryPx=0
    if (!orphan) {
      gOpens.forEach(o => { wEntryPx += (o.px||0)*(o.sz||0); totalOpenSz += o.sz||0 })
    }
    const entryPrice   = (!orphan && totalOpenSz > 0) ? wEntryPx/totalOpenSz : null
    const entryTime    = (!orphan && gOpens.length > 0) ? gOpens[0].time : null
    const durationMins = entryTime ? Math.max(0,(exitTime-entryTime)/60000) : null

    const symbol     = normaliseHLSymbol(coin)
    const hour       = exitTime.getUTCHours()
    const positionId = `HL_${coin.replace(/\W/g,'')}_${exitTime.getTime()}_${gi}`

    const { notional_usd, method: notional_method } = calculateNotionalUSD(
      pnlUsd, entryPrice, exitPrice, totalCloseSz, direction
    )

    trades.push({
      position_id:   positionId,
      account_id:    accountId,
      broker:        'Hyperliquid',
      entry_time:    entryTime?.toISOString()||null,
      exit_time:     exitTime.toISOString(),
      symbol,
      direction,
      size:          Math.round(totalCloseSz*1e6)/1e6,
      entry_price:   entryPrice ? Math.round(entryPrice*1e6)/1e6 : null,
      exit_price:    exitPrice  ? Math.round(exitPrice *1e4)/1e4  : null,
      notional_usd,
      notional_method,
      pnl:           pnlUsd,
      pct_gain:      null,
      fee,
      duration_mins: durationMins ? Math.round(durationMins*10)/10 : null,
      currency,
      session:       getSession(hour),
      day_of_week:   exitTime.toLocaleDateString('en-US',{weekday:'long',timeZone:'UTC'}),
      tv_symbol:     getTvSymbol(symbol),
      raw_direction: repClose.ev.dir,
      order_type:    'MARKET',
    })
  })

  return { broker:'Hyperliquid', accountId, currency, trades }
}

export function isHyperliquid(rows) {
  // Both native and third-party formats start with: time,coin,dir,px,sz
  return rows.slice(0,3).some(r =>
    r[0]==='time' && r[1]==='coin' && r[2]==='dir' && r[3]==='px' && r[4]==='sz'
  )
}
