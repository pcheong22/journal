// lib/parsers/hypurrscan.js
// Parses Hypurrscan CSV export format:
//   class, hash, time, time_iso, token, type, amount, from, to, px, fee, USDAmount, priority, coreHash
//
// Behaviour:
//   - All timestamps in time_iso are UTC — no timezone conversion needed
//   - Groups fills into completed trades (Open→Close pairs) using the same
//     net-position logic as the native parser
//   - Returns { trades, upsertMode: true } so the upload API knows to
//     UPDATE existing trades (matched by account_id + symbol + exit_time proximity)
//     rather than INSERT — this lets Hypurrscan data enrich/override native uploads
//   - Also captures TWAP trades that don't appear in the native CSV

import { getSession, getTvSymbol, normaliseSymbol, calculateNotionalUSD } from '../parserUtils'

// Hypurrscan token names → normalised symbols
function normaliseHSSymbol(token) {
  if (!token) return token
  // "HYPE-USD" → "HYPE", "xyz:SILVER-USD" → "SILVER (xyz)", "XLM-USD" → "XLM"
  // Handle spot tokens: "HYPE" (no dash) → "HYPE"
  const cleaned = token
    .replace(/^xyz:/, '')      // remove xyz: prefix
    .replace(/-USD$/, '')      // remove -USD suffix
    .replace(/-USDC$/, '')     // remove -USDC suffix
    .trim()
  return normaliseSymbol(cleaned)
}

function directionFromType(type) {
  if (type === 'Close Long'  || type === 'Sell') return 'Long'
  if (type === 'Close Short' || type === 'Buy')  return 'Short'
  return null
}
function isOpen(type)   { return type === 'Open Long' || type === 'Open Short' || type === 'Buy' }
function isClose(type) { return type === 'Close Long' || type === 'Close Short' || type === 'Sell' }
// Twap rows are treated as regular fills (positive = open, negative = close)

export function isHypurrscan(rows) {
  // Hypurrscan CSVs have: class, hash, time, time_iso, token, type, amount
  return rows.slice(0, 3).some(r =>
    r[0] === 'class' && r[1] === 'hash' && r[3] === 'time_iso' && r[4] === 'token'
  )
}

export function parseHypurrscan(rows, filename, accountId) {
  const currency = 'USDC'

  const headerIdx = rows.findIndex(r => r[0] === 'class' && r[1] === 'hash')
  if (headerIdx < 0) return { broker: 'Hyperliquid', accountId: accountId || 'HL_DEFAULT', currency, trades: [], upsertMode: true }

  const header   = rows[headerIdx]
  const col      = name => header.indexOf(name)
  const iClass   = col('class')
  const iTimeIso = col('time_iso')
  const iToken   = col('token')
  const iType    = col('type')
  const iAmount  = col('amount')
  const iPx      = col('px')
  const iFee     = col('fee')
  const iHash    = col('hash')
  const iFrom    = col('from')

  // Auto-detect wallet address from 'from' column if accountId not provided
  if (!accountId && iFrom >= 0) {
    const dataRows0 = rows.slice(headerIdx + 1)
    for (const r of dataRows0) {
      const fromVal = String(r[iFrom] || '').trim()
      if (fromVal.startsWith('0x') && fromVal.length === 42) {
        accountId = fromVal
        break
      }
    }
  }
  if (!accountId) accountId = 'HL_DEFAULT'

  const parseNum = s => { const n = parseFloat(String(s || '').replace(/,/g, '')); return isNaN(n) ? null : n }

  const dataRows = rows.slice(headerIdx + 1).filter(r => r.length > 4 && r[iTimeIso])

  // Only process PERP rows (class === 'PERP').
  // Twap rows are treated as regular open/close fills based on amount sign.
  // Skip WITHDRAW, SPOT, TRANSFER, order etc.
  const fills = []
  dataRows.forEach(r => {
    const cls  = String(r[iClass] || '').trim()
    const type = String(r[iType]  || '').trim()
    if (cls !== 'PERP') return
    if (!isOpen(type) && !isClose(type) && type !== 'Twap') return

    const timeIso = String(r[iTimeIso] || '').trim()
    const time    = new Date(timeIso)
    if (isNaN(time)) return

    const amount = parseNum(r[iAmount]) // negative = sell/short, positive = buy/long
    if (amount === null || amount === 0) return

    // For Twap rows: positive amount = open (buy), negative = close (sell)
    // Normalise type to Open/Close so downstream logic works uniformly
    let normType = type
    if (type === 'Twap') {
      normType = amount >= 0 ? 'Open Long' : 'Close Long'
    }

    fills.push({
      time,
      type:   normType,
      token:  String(r[iToken] || '').trim(),
      amount: Math.abs(amount),
      sign:   amount >= 0 ? 1 : -1,
      px:     parseNum(r[iPx]),
      fee:    Math.abs(parseNum(r[iFee]) || 0),
      hash:   String(r[iHash] || '').trim(),
    })
  })

  fills.sort((a, b) => a.time - b.time)

  // TWAP rows are already normalised to Open Long/Close Long above.
  // All fills are now treated uniformly — no special TWAP pairing needed.
  const otherFills = fills

  // ── Group close fills into close events (sequential, 2-min gap) ─────────
  const CLOSE_GROUP_GAP_MS = 2 * 60 * 1000
  const ORPHAN_GAP_MS      = 24 * 60 * 60 * 1000

  const closeFills = otherFills.filter(f => isClose(f.type))
  const openFills  = otherFills.filter(f => isOpen(f.type))

  const closeEvents = []
  if (closeFills.length > 0) {
    let curGroup = [closeFills[0]]
    const emitGroup = () => {
      let totalSz = 0, wPx = 0, totalFee = 0
      curGroup.forEach(f => { wPx += (f.px || 0) * f.amount; totalSz += f.amount; totalFee += f.fee })
      closeEvents.push({
        token:   curGroup[0].token,
        type:    curGroup[0].type,
        time:    curGroup[curGroup.length - 1].time,
        sz:      totalSz,
        px:      totalSz > 0 ? wPx / totalSz : null,
        fee:     totalFee,
      })
    }
    for (let i = 1; i < closeFills.length; i++) {
      const f = closeFills[i], prev = curGroup[curGroup.length - 1]
      const gap = f.time.getTime() - prev.time.getTime()
      if (f.token === prev.token && f.type === prev.type && gap <= CLOSE_GROUP_GAP_MS) {
        curGroup.push(f)
      } else {
        emitGroup(); curGroup = [f]
      }
    }
    emitGroup()
  }

  closeEvents.sort((a, b) => a.time - b.time)
  openFills.sort((a, b) => a.time - b.time)

  // ── Net position tracking (same logic as native parser) ─────────────────
  const tradeGroups = []

  const eventsByTokenDir = {}
  openFills.forEach(f => {
    const dir = f.type === 'Open Long' ? 'Long' : 'Short'
    const key = `${f.token}|${dir}`
    if (!eventsByTokenDir[key]) eventsByTokenDir[key] = []
    eventsByTokenDir[key].push({ type: 'open', time: f.time, sz: f.amount, px: f.px, fee: f.fee })
  })
  closeEvents.forEach(ev => {
    const dir = directionFromType(ev.type)
    if (!dir) return
    const key = `${ev.token}|${dir}`
    if (!eventsByTokenDir[key]) eventsByTokenDir[key] = []
    eventsByTokenDir[key].push({ type: 'close', time: ev.time, sz: ev.sz, px: ev.px, fee: ev.fee, token: ev.token, closeType: ev.type })
  })

  Object.entries(eventsByTokenDir).forEach(([key, events]) => {
    events.sort((a, b) => a.time - b.time)
    const token = key.split('|')[0]
    const dir   = key.split('|')[1]

    let netPos = 0, curOpens = [], curCloses = [], orphanBuf = [], orphanEndMs = 0

    const flushOrphan = () => {
      if (!orphanBuf.length) return
      tradeGroups.push({ opens: [], closes: [...orphanBuf], orphan: true, token, dir })
      orphanBuf = []; orphanEndMs = 0
    }
    const flushTrade = () => {
      if (!curCloses.length) return
      tradeGroups.push({ opens: [...curOpens], closes: [...curCloses], orphan: false, token, dir })
      curOpens = []; curCloses = []; netPos = 0
    }

    events.forEach(ev => {
      if (ev.type === 'open') {
        flushOrphan(); netPos += ev.sz; curOpens.push(ev)
      } else if (netPos <= 0) {
        const tMs = ev.time.getTime()
        if (orphanBuf.length && tMs - orphanEndMs > ORPHAN_GAP_MS) flushOrphan()
        orphanBuf.push(ev); orphanEndMs = tMs
      } else if (ev.sz <= netPos + 0.001) {
        netPos -= ev.sz; curCloses.push(ev)
        if (Math.abs(netPos) < 0.001) flushTrade()
      } else {
        const mf = netPos / ev.sz, of = 1 - mf
        curCloses.push({ ...ev, sz: netPos }); flushTrade()
        const orp = { ...ev, sz: ev.sz * of }
        const tMs = ev.time.getTime()
        if (orphanBuf.length && tMs - orphanEndMs > ORPHAN_GAP_MS) flushOrphan()
        orphanBuf.push(orp); orphanEndMs = tMs
      }
    })
    flushOrphan()
    if (curCloses.length) flushTrade()
  })

  // ── Build trade objects from regular groups ──────────────────────────────
  const trades = []

  const buildTrade = ({ opens, closes, orphan, token, dir }, gi, isTwapTrade = false) => {
    if (!closes.length) return

    let totalCloseSz = 0, wExitPx = 0, totalFee = 0
    closes.forEach(c => {
      wExitPx      += (c.px || 0) * c.sz
      totalCloseSz += c.sz
      totalFee     += c.fee || 0
    })
    const exitPrice = totalCloseSz > 0 ? wExitPx / totalCloseSz : null
    const fee       = Math.round(totalFee * 100) / 100
    const exitTime  = closes.reduce((t, c) => c.time > t ? c.time : t, closes[0].time)

    let totalOpenSz = 0, wEntryPx = 0
    if (!orphan) {
      opens.forEach(o => { wEntryPx += (o.px || 0) * o.sz; totalOpenSz += o.sz })
    }
    const entryPrice   = (!orphan && totalOpenSz > 0) ? wEntryPx / totalOpenSz : null
    const entryTime    = (!orphan && opens.length > 0)
      ? opens.reduce((t, o) => o.time < t ? o.time : t, opens[0].time)
      : null
    const durationMins = entryTime ? Math.max(0, (exitTime - entryTime) / 60000) : null

    const symbol     = normaliseHSSymbol(token)
    const hour       = exitTime.getUTCHours()
    const positionId = `HL_${String(token).replace(/\W/g, '')}_${exitTime.getTime()}_hs${gi}`

    // pnl is not in Hypurrscan fills — set to null, will be preserved from
    // the existing trade if this is an upsert (enrichment mode)
    const pnlUsd = null

    const { notional_usd, method: notional_method } = calculateNotionalUSD(
      pnlUsd, entryPrice, exitPrice, totalCloseSz, dir
    )

    trades.push({
      position_id:     positionId,
      account_id:      accountId,
      broker:          'Hyperliquid',
      entry_time:      entryTime?.toISOString() || null,
      exit_time:       exitTime.toISOString(),
      symbol,
      direction:       dir,
      size:            Math.round(totalCloseSz * 1e6) / 1e6,
      entry_price:     entryPrice ? Math.round(entryPrice * 1e6) / 1e6 : null,
      exit_price:      exitPrice  ? Math.round(exitPrice  * 1e4) / 1e4 : null,
      notional_usd,
      notional_method,
      pnl:             pnlUsd,
      fee,
      duration_mins:   durationMins ? Math.round(durationMins * 10) / 10 : null,
      currency,
      session:         getSession(hour),
      day_of_week:     exitTime.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
      tv_symbol:       getTvSymbol(symbol),
      raw_direction:   dir === 'Long' ? 'Close Long' : 'Close Short',
      order_type:      isTwapTrade ? 'TWAP' : 'MARKET',
      // upsert_key used by the upload API to match against existing trades
      _upsert_key:     { account_id: accountId, symbol, exit_time: exitTime.toISOString() },
    })
  }

  tradeGroups.forEach((g, i) => buildTrade(g, i))

  // ── Add TWAP trades ──────────────────────────────────────────────────────

  return {
    broker:     'Hyperliquid',
    accountId,
    currency,
    trades,
    upsertMode: true, // tells upload API to enrich/override rather than insert
  }
}
