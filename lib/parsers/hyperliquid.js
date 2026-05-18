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

  // ── Consolidate close events into trades (30-min window) ────────────────
  const CONSOLIDATE_MS = 30 * 60 * 1000
  closeEvents.sort((a, b) => a.time - b.time)

  const tradeGroups  = []
  const usedEvtIdxs  = new Set()

  for (let i = 0; i < closeEvents.length; i++) {
    if (usedEvtIdxs.has(i)) continue
    usedEvtIdxs.add(i)
    const anchor = closeEvents[i]
    const group  = [anchor]

    // Find all subsequent events for same coin+dir within window
    for (let j = i + 1; j < closeEvents.length; j++) {
      if (usedEvtIdxs.has(j)) continue
      const ev = closeEvents[j]
      if (ev.coin === anchor.coin &&
          ev.dir  === anchor.dir  &&
          ev.time - anchor.time   <= CONSOLIDATE_MS) {
        group.push(ev)
        usedEvtIdxs.add(j)
      }
    }
    tradeGroups.push(group)
  }

  opens.sort((a,b) => a.time - b.time)
  const usedOpenIdxs = new Set()
  const trades = []

  tradeGroups.forEach((group, gi) => {
    group.sort((a,b) => a.time - b.time)
    const rep       = group[0]
    const direction = directionFromClose(rep.dir, rep.pnl)
    const openSides = openSideFor(direction)
    const coin      = rep.coin
    const exitTime  = group[group.length-1].time

    let totalSz=0, weightedPx=0, totalPnl=0, totalFee=0
    group.forEach(ev => {
      weightedPx+=(ev.exitPrice||0)*ev.size; totalSz+=ev.size
      totalPnl+=ev.pnl; totalFee+=ev.fee
    })
    const exitPrice = totalSz>0 ? weightedPx/totalSz : null
    const pnlUsd    = Math.round(totalPnl*100)/100
    const fee       = Math.round(totalFee*100)/100

    // Match ALL opening fills before this close — weighted average entry price
    const firstCloseTime = group[0].time
    const matchedOpens = []
    for (let i = 0; i < opens.length; i++) {
      const o = opens[i]
      if (!usedOpenIdxs.has(i) && o.coin === coin &&
          openSides.includes(o.dir) && o.time <= firstCloseTime) {
        matchedOpens.push({ idx:i, o })
      }
    }
    // Mark all matched opens as used
    matchedOpens.forEach(({ idx }) => usedOpenIdxs.add(idx))

    // Weighted average entry price across all matched opens
    let openSzTotal = 0, openPxWeighted = 0
    matchedOpens.forEach(({ o }) => {
      const sz = o.sz || 0
      openPxWeighted += (o.px || 0) * sz
      openSzTotal    += sz
    })
    const entryPrice   = openSzTotal > 0 ? openPxWeighted / openSzTotal : (matchedOpens[0]?.o.px || null)
    const entryTime    = matchedOpens.length > 0 ? matchedOpens[0].o.time : null
    const durationMins = entryTime ? Math.max(0, (exitTime - entryTime) / 60000) : null
    const hour         = exitTime.getUTCHours()
    const symbol       = normaliseHLSymbol(coin)
    const positionId   = `HL_${coin.replace(/\W/g,'')}_${exitTime.getTime()}_${gi}`

    const { notional_usd, method: notional_method } = calculateNotionalUSD(
      pnlUsd, entryPrice, exitPrice, totalSz, direction
    )

    trades.push({
      position_id:   positionId,
      account_id:    accountId,
      broker:        'Hyperliquid',
      entry_time:    entryTime?.toISOString()||null,
      exit_time:     exitTime.toISOString(),
      symbol,
      direction,
      size:          Math.round(totalSz*100000)/100000,
      entry_price:   entryPrice,
      exit_price:    exitPrice ? Math.round(exitPrice*10000)/10000 : null,
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
      raw_direction: rep.dir,
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
