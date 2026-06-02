// lib/parsers/bybit.js
// Handles two Bybit export formats produced by the pre-processing script:
//
// 1. PERP (bybit_perps_*.csv):
//    symbol, currency, direction, qty, entry_price, exit_price, pnl,
//    exit_time, entry_time, fee, exit_type
//    → one row per closed position, direct from Bybit ClosedPL exports
//
// 2. SPOT (bybit_spot_*.csv):
//    symbol, direction, entry_time, exit_time, entry_price, exit_price,
//    qty, pnl, currency
//    → FIFO-matched buy→sell round trips, USDT/USDC pools merged per asset
//
// Both files are identified by their header row.

import { getSession, getTvSymbol, normaliseSymbol, calculateNotionalUSD } from '../parserUtils'

// ── Detection ─────────────────────────────────────────────────────────────────

export function isBybitPerp(rows) {
  return rows.slice(0, 3).some(r =>
    r[0] === 'symbol' && r[1] === 'currency' && r[2] === 'direction' &&
    r[3] === 'qty' && r[4] === 'entry_price'
  )
}

export function isBybitSpot(rows) {
  return rows.slice(0, 3).some(r =>
    r[0] === 'symbol' && r[1] === 'direction' && r[2] === 'entry_time' &&
    r[3] === 'exit_time' && r[4] === 'entry_price'
  )
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

const parseNum = s => {
  const n = parseFloat(String(s || '').replace(/,/g, ''))
  return isNaN(n) ? null : n
}

function buildTrade({ symbol, direction, entryTime, exitTime, entryPrice,
  exitPrice, qty, pnl, fee, currency, accountId, broker, orderType }) {

  const et   = exitTime  ? new Date(exitTime)  : null
  const nt   = entryTime ? new Date(entryTime) : null
  const hour = et ? et.getUTCHours() : 0

  const durationMins = (et && nt && !isNaN(et) && !isNaN(nt))
    ? Math.max(0, (et - nt) / 60000)
    : null

  const sym = normaliseSymbol(symbol)

  // Include entry_time ms + pnl to ensure uniqueness across FIFO-split spot trades
  const positionId = [
    'BB',
    sym.replace(/\W/g, ''),
    direction[0],
    et  ? et.getTime()  : Math.random(),
    nt  ? nt.getTime()  : 0,
    pnl != null ? Math.round(pnl * 100) : 0,
  ].join('_')

  const { notional_usd, method: notional_method } = calculateNotionalUSD(
    pnl, entryPrice, exitPrice, qty, direction
  )

  return {
    position_id:    positionId,
    account_id:     accountId,
    broker,
    entry_time:     nt && !isNaN(nt) ? nt.toISOString() : null,
    exit_time:      et && !isNaN(et) ? et.toISOString() : null,
    symbol:         sym,
    direction,
    size:           qty != null ? Math.round(qty * 1e8) / 1e8 : null,
    entry_price:    entryPrice != null ? Math.round(entryPrice * 1e8) / 1e8 : null,
    exit_price:     exitPrice  != null ? Math.round(exitPrice  * 1e8) / 1e8 : null,
    notional_usd,
    notional_method,
    pnl:            pnl != null ? Math.round(pnl * 100) / 100 : null,
    pct_gain:       null,
    fee:            fee != null ? Math.round(Math.abs(fee) * 1e6) / 1e6 : null,
    duration_mins:  durationMins != null ? Math.round(durationMins * 10) / 10 : null,
    currency:       currency || 'USDT',
    session:        getSession(hour),
    day_of_week:    et && !isNaN(et)
      ? et.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
      : null,
    tv_symbol:      getTvSymbol(sym),
    raw_direction:  direction,
    order_type:     orderType || 'MARKET',
  }
}

// ── Perp parser ───────────────────────────────────────────────────────────────

export function parseBybitPerp(rows, filename, accountId) {
  const headerIdx = rows.findIndex(r =>
    r[0] === 'symbol' && r[1] === 'currency' && r[2] === 'direction'
  )
  if (headerIdx < 0) return { broker: 'Bybit', accountId, currency: 'USDT', trades: [] }

  const header = rows[headerIdx]
  const col    = name => header.indexOf(name)

  const iSymbol     = col('symbol')
  const iCurrency   = col('currency')
  const iDirection  = col('direction')
  const iQty        = col('qty')
  const iEntryPrice = col('entry_price')
  const iExitPrice  = col('exit_price')
  const iPnl        = col('pnl')
  const iExitTime   = col('exit_time')
  const iEntryTime  = col('entry_time')
  const iFee        = col('fee')

  const trades = []

  rows.slice(headerIdx + 1).forEach(r => {
    if (!r[iSymbol]) return
    const pnl       = parseNum(r[iPnl])
    const entryPrice = parseNum(r[iEntryPrice])
    const exitPrice  = parseNum(r[iExitPrice])
    const qty        = parseNum(r[iQty])
    const fee        = parseNum(r[iFee]) || 0
    const currency   = String(r[iCurrency] || 'USDT').trim()
    const direction  = String(r[iDirection] || '').trim()
    const symbol     = String(r[iSymbol] || '').trim()

    if (pnl == null || !direction || !symbol) return

    trades.push(buildTrade({
      symbol,
      direction,
      entryTime:  String(r[iEntryTime] || '').trim(),
      exitTime:   String(r[iExitTime]  || '').trim(),
      entryPrice,
      exitPrice,
      qty,
      pnl,
      fee,
      currency,
      accountId,
      broker: 'Bybit',
      orderType: 'MARKET',
    }))
  })

  return {
    broker:    'Bybit',
    accountId,
    currency:  'USDT',
    trades,
  }
}

// ── Spot parser ────────────────────────────────────────────────────────────────

export function parseBybitSpot(rows, filename, accountId) {
  const headerIdx = rows.findIndex(r =>
    r[0] === 'symbol' && r[1] === 'direction' && r[2] === 'entry_time'
  )
  if (headerIdx < 0) return { broker: 'Bybit', accountId, currency: 'USDT', trades: [] }

  const header = rows[headerIdx]
  const col    = name => header.indexOf(name)

  const iSymbol     = col('symbol')
  const iDirection  = col('direction')
  const iEntryTime  = col('entry_time')
  const iExitTime   = col('exit_time')
  const iEntryPrice = col('entry_price')
  const iExitPrice  = col('exit_price')
  const iQty        = col('qty')
  const iPnl        = col('pnl')
  const iCurrency   = col('currency')

  const trades = []

  rows.slice(headerIdx + 1).forEach(r => {
    if (!r[iSymbol]) return
    const pnl        = parseNum(r[iPnl])
    const entryPrice = parseNum(r[iEntryPrice])
    const exitPrice  = parseNum(r[iExitPrice])
    const qty        = parseNum(r[iQty])
    const currency   = String(r[iCurrency] || 'USDT').trim()
    const symbol     = String(r[iSymbol] || '').trim()

    if (pnl == null || !symbol) return

    trades.push(buildTrade({
      symbol,
      direction:  'Long', // spot is always long (buy then sell)
      entryTime:  String(r[iEntryTime] || '').trim(),
      exitTime:   String(r[iExitTime]  || '').trim(),
      entryPrice,
      exitPrice,
      qty,
      pnl,
      fee:        null,
      currency,
      accountId,
      broker: 'Bybit',
      orderType: 'SPOT',
    }))
  })

  return {
    broker:    'Bybit',
    accountId,
    currency:  'USDT',
    trades,
  }
}
