// lib/parsers/primexbt.js
// Parses PrimeXBT orders CSV export
// Filename format: YYYY-MM-DD_ACCOUNTID_CURRENCY_orders.csv
// e.g. 2026-05-08_L259832_USDC_orders.csv

import { getSession, getTvSymbol, normaliseSymbol, parseDate, calculateNotionalUSD } from '../parserUtils'

export function extractPrimeXBTMeta(filename) {
  const fn    = filename.replace(/\.csv$/i, '')
  const parts = fn.split('_')
  const CURRENCIES = ['USDC','USD','USDT','BTC','ETH']
  if (parts.length >= 3) {
    const maybeAcc = parts[1]
    const maybeCur = parts[2]?.toUpperCase()
    if (maybeAcc && /^[A-Z0-9]+$/i.test(maybeAcc)) {
      return {
        accountId: maybeAcc,
        currency:  CURRENCIES.includes(maybeCur) ? maybeCur : 'USDC',
      }
    }
  }
  return { accountId: `PXT_${Date.now()}`, currency: 'USDC' }
}

export function parsePrimeXBT(rows, accountId, currency = 'USDC') {
  // Find header row
  let hRow = -1
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const j = (rows[i] || []).join('|').toLowerCase()
    if (j.includes('order id') || j.includes('placed time')) { hRow = i; break }
  }
  if (hRow < 0) throw new Error('Cannot find header row in PrimeXBT file')

  const hdrs  = rows[hRow].map(h => String(h || '').trim().toLowerCase())
  const col   = names => {
    for (const n of names) {
      const i = hdrs.findIndex(h => h.includes(n))
      if (i >= 0) return i
    }
    return -1
  }

  const iId       = col(['order id'])
  const iSym      = col(['symbol'])
  const iType     = col(['type'])
  const iSide     = col(['side'])
  const iStatus   = col(['status'])
  const iAmount   = col(['amount'])
  const iExecPx   = col(['executed price'])
  const iPnl      = col(['round settled p/l'])
  const iRoi      = col(['roi'])
  const iFee      = col(['fee'])
  const iPlaced   = col(['placed time'])
  const iClosed   = col(['closed time'])

  if (iId < 0 || iPnl < 0) throw new Error('Required PrimeXBT columns missing — check file format')

  // Parse all executed rows
  const all = []
  for (let i = hRow + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length < 3) continue
    const status = iStatus >= 0 ? String(r[iStatus] || '').trim() : ''
    if (!['EXECUTED','PARTIAL_EXECUTED'].includes(status)) continue

    const orderId    = String(r[iId]    || '').trim()
    const symbol     = iSym  >= 0 ? String(r[iSym]  || '').trim() : ''
    const side       = iSide >= 0 ? String(r[iSide] || '').trim().toUpperCase() : ''
    const orderType  = iType >= 0 ? String(r[iType] || '').trim() : ''
    const amount     = iAmount  >= 0 ? parseFloat(String(r[iAmount]).replace(/,/g,''))  : NaN
    const execPrice  = iExecPx  >= 0 ? parseFloat(String(r[iExecPx]).replace(/,/g,''))  : NaN
    const pnlRaw     = iPnl     >= 0 ? parseFloat(String(r[iPnl]).replace(/,/g,''))     : NaN
    const roi        = iRoi     >= 0 ? parseFloat(String(r[iRoi]).replace(/,/g,''))     : NaN
    const fee        = iFee     >= 0 ? parseFloat(String(r[iFee]).replace(/,/g,''))     : NaN
    const placedTime = iPlaced  >= 0 ? parseDate(String(r[iPlaced] || '').trim())  : null
    const closedTime = iClosed  >= 0 && r[iClosed] ? parseDate(String(r[iClosed] || '').trim()) : null

    if (!placedTime || !orderId || !symbol || !side) continue

    all.push({ orderId, symbol, side, orderType, amount, execPrice, pnlRaw, roi, fee, placedTime, closedTime })
  }

  // Closing orders have non-zero P&L; opening orders have zero/null P&L
  const closing = all.filter(r => !isNaN(r.pnlRaw) && r.pnlRaw !== 0)
  const opening = all.filter(r => isNaN(r.pnlRaw)  || r.pnlRaw === 0)
    .sort((a, b) => a.placedTime - b.placedTime)

  const trades      = []
  const usedOpenIds = new Set()

  for (const close of closing) {
    const direction = close.side === 'SELL' ? 'Long' : 'Short'
    const openSide  = close.side === 'SELL' ? 'BUY'  : 'SELL'

    // Match nearest un-used opening order: same symbol, opposite side, before close
    let bestOpen = null
    for (let j = opening.length - 1; j >= 0; j--) {
      const o = opening[j]
      if (o.symbol === close.symbol &&
          o.side   === openSide &&
          o.placedTime <= close.placedTime &&
          !usedOpenIds.has(o.orderId)) {
        bestOpen = o; break
      }
    }
    if (bestOpen) usedOpenIds.add(bestOpen.orderId)

    const entryTime    = bestOpen ? bestOpen.placedTime : close.placedTime
    const exitTime     = close.closedTime || close.placedTime
    const durationMins = Math.max(0, (exitTime - entryTime) / 60000)
    const entryPrice   = bestOpen && !isNaN(bestOpen.execPrice) ? bestOpen.execPrice : null
    const exitPrice    = !isNaN(close.execPrice) ? close.execPrice : null
    const amount       = !isNaN(close.amount) ? close.amount : null
    const pnlUsd       = Math.round(close.pnlRaw * 100) / 100
    const pctGain      = !isNaN(close.roi) && isFinite(close.roi) ? close.roi : null
    const fee          = !isNaN(close.fee) ? Math.abs(close.fee) : 0

    // Back-solve notional from actual price move (exit/entry - 1), not broker ROI
    const { notional_usd, method: notional_method } = calculateNotionalUSD(
      pnlUsd, entryPrice, exitPrice, amount, direction
    )
    const hour         = entryTime.getUTCHours()
    const normSym      = normaliseSymbol(close.symbol)

    trades.push({
      position_id:   close.orderId,
      account_id:    accountId,
      broker:        'PrimeXBT',
      entry_time:    entryTime.toISOString(),
      exit_time:     exitTime.toISOString(),
      symbol:        normSym,
      direction,
      size:          amount,
      entry_price:   entryPrice,
      exit_price:    exitPrice,
      notional_usd:  notional_usd,
      notional_method: notional_method,
      pnl:           pnlUsd,
      pct_gain:      pctGain,
      fee,
      duration_mins: Math.round(durationMins * 10) / 10,
      currency,
      session:       getSession(hour),
      day_of_week:   entryTime.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
      tv_symbol:     getTvSymbol(normSym),
      raw_direction: close.side,
      order_type:    close.orderType,
    })
  }

  return trades
}
