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
  const cleaned = coin.replace(/\s*\(.*?\)/g, '').replace(/^[a-z]+:/, '').trim()
  return normaliseSymbol(cleaned)
}

function parseHLDate(s) {
  s = String(s || '').trim()
  const native = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2}:\d{2}:\d{2})/)
  if (native) return new Date(`${native[3]}-${native[2]}-${native[1]}T${native[4]}Z`)
  return new Date(s.replace(' ', 'T').replace(/(\.\d+)?$/, 'Z'))
}

function isClosing(dir) {
  return dir === 'Close Long' || dir === 'Close Short' || dir === 'Sell'
}
function isOpening(dir) {
  return dir === 'Open Long' || dir === 'Open Short' || dir === 'Buy'
}
function directionFromClose(dir) {
  if (dir === 'Close Long' || dir === 'Sell') return 'Long'
  return 'Short'
}

export function parseHyperliquid(rows, filename, accountId) {
  const currency = 'USDC'

  const headerIdx = rows.findIndex(r => r[0] === 'time' && r[1] === 'coin')
  if (headerIdx < 0) return { broker:'Hyperliquid', accountId, currency, trades:[] }

  const header  = rows[headerIdx]
  const hasHash = header.includes('hash')
  const col     = name => header.indexOf(name)

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

  const allFills = []
  dataRows.forEach(r => {
    const dir  = String(r[iDir]||'').trim()
    const time = parseHLDate(r[iTime])
    if (isNaN(time)) return
    if (!isClosing(dir) && !isOpening(dir)) return
    allFills.push({
      time, dir,
      pnl:  parseNum(r[iClosedPnl]) || 0,
      coin: String(r[iCoin]||'').trim(),
      px:   parseNum(r[iPx]),
      sz:   parseNum(r[iSz]) || 0,
      fee:  Math.abs(parseNum(r[iFee]) || 0),
      hash: iHash >= 0 ? String(r[iHash]||'').trim() : null,
    })
  })

  allFills.sort((a, b) => a.time - b.time)

  // ── Step 1: Group close fills into close events ──────────────────────────
  // Multiple fill rows for the same close order need to be aggregated first.
  // Grouping strategy:
  //   - With hash: same hash = same order
  //   - Without hash: same coin + same close direction + within 2 minutes = same order
  // This prevents each partial fill from becoming a separate trade.

  const CLOSE_GROUP_GAP_MS = 2 * 60 * 1000  // 2 minutes covers market depth fills

  const closeFills = allFills.filter(f => isClosing(f.dir))
  const openFills  = allFills.filter(f => isOpening(f.dir))

  const closeEvents = [] // aggregated close events: {coin, dir, time, sz, px, pnl, fee}

  // Group by hash first if available, then by proximity
  if (closeFills.length && closeFills[0].hash) {
    // Hash-based grouping
    const byHash = {}
    closeFills.forEach(f => {
      const k = f.hash || `${f.coin}|${f.dir}|${f.time.getTime()}`
      if (!byHash[k]) byHash[k] = []
      byHash[k].push(f)
    })
    Object.values(byHash).forEach(group => {
      group.sort((a, b) => a.time - b.time)
      let totalSz=0, wPx=0, totalPnl=0, totalFee=0
      group.forEach(f => { wPx += f.px*f.sz; totalSz += f.sz; totalPnl += f.pnl; totalFee += f.fee })
      closeEvents.push({
        coin: group[0].coin, dir: group[0].dir,
        time: group[group.length-1].time,
        sz: totalSz, px: totalSz > 0 ? wPx/totalSz : null,
        pnl: totalPnl, fee: totalFee,
      })
    })
  } else {
    // Sequential grouping: walk fills in time order per coin+dir.
    // Gap from PREVIOUS fill > 2 min = new close event.
    // Groups partial fills of one order (seconds apart) while separating
    // different orders (minutes/hours apart).
    if (closeFills.length > 0) {
      let curGroup = [closeFills[0]]
      const emitGroup = () => {
        let totalSz=0, wPx=0, totalPnl=0, totalFee=0
        curGroup.forEach(g => { wPx += (g.px||0)*g.sz; totalSz += g.sz; totalPnl += g.pnl; totalFee += g.fee })
        closeEvents.push({
          coin: curGroup[0].coin, dir: curGroup[0].dir,
          time: curGroup[curGroup.length-1].time,
          sz: totalSz, px: totalSz > 0 ? wPx/totalSz : null,
          pnl: totalPnl, fee: totalFee,
        })
      }
      for (let i = 1; i < closeFills.length; i++) {
        const f    = closeFills[i]
        const prev = curGroup[curGroup.length-1]
        const gap  = f.time.getTime() - prev.time.getTime()
        if (f.coin === prev.coin && f.dir === prev.dir && gap <= CLOSE_GROUP_GAP_MS) {
          curGroup.push(f)
        } else {
          emitGroup()
          curGroup = [f]
        }
      }
      emitGroup()
    }
  }

  closeEvents.sort((a, b) => a.time - b.time)
  openFills.sort((a, b) => a.time - b.time)

  // ── Step 2: Net position tracking per coin+direction ─────────────────────
  // Walk opens and aggregated close events chronologically.
  // When net hits 0 → completed trade.
  // When a close event exceeds remaining net → split proportionally:
  //   matched portion → completes current trade
  //   excess portion  → orphan (opened in prior upload)
  // Close events with no prior open → pure orphan.
  // Orphan events grouped into sessions (gap > 2 min = new session).

  const ORPHAN_GAP_MS = 2 * 60 * 1000
  const tradeGroups   = []

  // Build per coin+dir event list
  const eventsByCoinDir = {}

  openFills.forEach(f => {
    const dir = f.dir === 'Open Long' || f.dir === 'Buy' ? 'Long' : 'Short'
    const key = `${f.coin}|${dir}`
    if (!eventsByCoinDir[key]) eventsByCoinDir[key] = []
    eventsByCoinDir[key].push({ type:'open', time:f.time, sz:f.sz, px:f.px, pnl:f.pnl, fee:f.fee })
  })

  closeEvents.forEach(ev => {
    const dir = directionFromClose(ev.dir)
    const key = `${ev.coin}|${dir}`
    if (!eventsByCoinDir[key]) eventsByCoinDir[key] = []
    eventsByCoinDir[key].push({ type:'close', time:ev.time, sz:ev.sz, px:ev.px, pnl:ev.pnl, fee:ev.fee, coin:ev.coin, dir:ev.dir })
  })

  Object.entries(eventsByCoinDir).forEach(([key, events]) => {
    events.sort((a, b) => a.time - b.time)

    let netPos     = 0
    let curOpens   = []
    let curCloses  = []
    let orphanBuf  = []
    let orphanEndMs = 0

    const flushOrphan = () => {
      if (!orphanBuf.length) return
      tradeGroups.push({ opens:[], closes:[...orphanBuf], orphan:true })
      orphanBuf = []; orphanEndMs = 0
    }
    const flushTrade = () => {
      if (!curCloses.length) return
      tradeGroups.push({ opens:[...curOpens], closes:[...curCloses], orphan:false })
      curOpens = []; curCloses = []; netPos = 0
    }

    events.forEach(ev => {
      if (ev.type === 'open') {
        flushOrphan()
        netPos += ev.sz
        curOpens.push(ev)
        return
      }

      // Close event
      if (netPos <= 0) {
        // Pure orphan
        const tMs = ev.time.getTime()
        if (orphanBuf.length && tMs - orphanEndMs > ORPHAN_GAP_MS) flushOrphan()
        orphanBuf.push(ev); orphanEndMs = tMs
        return
      }

      if (ev.sz <= netPos + 0.001) {
        // Fits entirely in current position
        netPos -= ev.sz
        curCloses.push(ev)
        if (Math.abs(netPos) < 0.001) flushTrade()
      } else {
        // Exceeds current position — split proportionally
        const matchFrac  = netPos / ev.sz
        const orphFrac   = 1 - matchFrac
        curCloses.push({ ...ev, sz: netPos, pnl: ev.pnl * matchFrac, fee: ev.fee * matchFrac })
        flushTrade()
        // Orphan portion
        const orp = { ...ev, sz: ev.sz * orphFrac, pnl: ev.pnl * orphFrac, fee: ev.fee * orphFrac }
        const tMs = ev.time.getTime()
        if (orphanBuf.length && tMs - orphanEndMs > ORPHAN_GAP_MS) flushOrphan()
        orphanBuf.push(orp); orphanEndMs = tMs
      }
    })

    flushOrphan()
    if (curCloses.length) flushTrade() // partial (position still open)
  })

  // ── Step 3: Build trade objects ─────────────────────────────────────────
  const trades = []

  tradeGroups.forEach((group, gi) => {
    const { opens: gOpens, closes: gCloses, orphan } = group
    if (!gCloses.length) return

    const repClose  = gCloses[0]
    const coin      = repClose.coin || repClose.coin
    const direction = directionFromClose(repClose.dir)

    // Aggregate closes
    let totalCloseSz=0, wExitPx=0, totalPnl=0, totalFee=0
    gCloses.forEach(c => {
      wExitPx      += (c.px||0) * c.sz
      totalCloseSz += c.sz
      totalPnl     += c.pnl
      totalFee     += c.fee||0
    })
    const exitPrice = totalCloseSz > 0 ? wExitPx / totalCloseSz : null
    const pnlUsd    = Math.round(totalPnl * 100) / 100
    const fee       = Math.round(totalFee * 100) / 100
    const exitTime  = gCloses.reduce((t, c) => c.time > t ? c.time : t, gCloses[0].time)

    // Aggregate opens (null for orphans)
    let totalOpenSz=0, wEntryPx=0
    if (!orphan) {
      gOpens.forEach(o => { wEntryPx += (o.px||0) * o.sz; totalOpenSz += o.sz })
    }
    const entryPrice   = (!orphan && totalOpenSz > 0) ? wEntryPx / totalOpenSz : null
    const entryTime    = (!orphan && gOpens.length > 0)
      ? gOpens.reduce((t, o) => o.time < t ? o.time : t, gOpens[0].time)
      : null
    const durationMins = entryTime ? Math.max(0, (exitTime - entryTime) / 60000) : null

    const coinName   = repClose.coin || (repClose.dir && repClose.dir)
    const symbol     = normaliseHLSymbol(coinName)
    const hour       = exitTime.getUTCHours()
    const positionId = `HL_${String(coinName).replace(/\W/g,'')}_${exitTime.getTime()}_${gi}`

    const { notional_usd, method: notional_method } = calculateNotionalUSD(
      pnlUsd, entryPrice, exitPrice, totalCloseSz, direction
    )

    trades.push({
      position_id:   positionId,
      account_id:    accountId,
      broker:        'Hyperliquid',
      entry_time:    entryTime?.toISOString() || null,
      exit_time:     exitTime.toISOString(),
      symbol,
      direction,
      size:          Math.round(totalCloseSz * 1e6) / 1e6,
      entry_price:   entryPrice ? Math.round(entryPrice * 1e6) / 1e6 : null,
      exit_price:    exitPrice  ? Math.round(exitPrice  * 1e4) / 1e4 : null,
      notional_usd,
      notional_method,
      pnl:           pnlUsd,
      pct_gain:      null,
      fee,
      duration_mins: durationMins ? Math.round(durationMins * 10) / 10 : null,
      currency,
      session:       getSession(hour),
      day_of_week:   exitTime.toLocaleDateString('en-US', { weekday:'long', timeZone:'UTC' }),
      tv_symbol:     getTvSymbol(symbol),
      raw_direction: repClose.dir,
      order_type:    'MARKET',
    })
  })

  return { broker:'Hyperliquid', accountId, currency, trades }
}

export function isHyperliquid(rows) {
  return rows.slice(0,3).some(r =>
    r[0]==='time' && r[1]==='coin' && r[2]==='dir' && r[3]==='px' && r[4]==='sz'
  )
}
