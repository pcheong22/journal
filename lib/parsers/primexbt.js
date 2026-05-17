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

  // ── Group closing orders into consolidated positions ──────────────────────
  // Multiple closing orders for the same symbol/side within 30 min = one trade
  const CONSOLIDATE_WINDOW = 30 * 60 * 1000
  const usedCloseIds = new Set()
  const groups = []

  for (const close of closing) {
    if (usedCloseIds.has(close.orderId)) continue
    // Find all related closes: same symbol, same side, within window
    const related = closing.filter(c =>
      !usedCloseIds.has(c.orderId) &&
      c.symbol === close.symbol &&
      c.side   === close.side &&
      Math.abs(c.placedTime - close.placedTime) <= CONSOLIDATE_WINDOW
    )
    related.forEach(c => usedCloseIds.add(c.orderId))
    groups.push(related)
  }

  const trades      = []
  const usedOpenIds = new Set()

  for (const group of groups) {
    // Use earliest close as the representative
    group.sort((a, b) => a.placedTime - b.placedTime)
    const rep       = group[0]
    const direction = rep.side === 'SELL' ? 'Long' : 'Short'
    const openSide  = rep.side === 'SELL' ? 'BUY'  : 'SELL'

    // Weighted average exit price across group
    let totalCloseAmt = 0, weightedExitPx = 0, totalPnl = 0, totalFee = 0
    for (const c of group) {
      const amt = isNaN(c.amount) ? 0 : c.amount
      const px  = isNaN(c.execPrice) ? 0 : c.execPrice
      weightedExitPx += px * amt
      totalCloseAmt  += amt
      totalPnl       += isNaN(c.pnlRaw) ? 0 : c.pnlRaw
      totalFee       += isNaN(c.fee) ? 0 : Math.abs(c.fee)
    }
    const exitPrice = totalCloseAmt > 0 ? weightedExitPx / totalCloseAmt : null
    const amount    = totalCloseAmt
    const pnlUsd    = Math.round(totalPnl * 100) / 100
    const fee       = Math.round(totalFee * 100) / 100

    // Match nearest un-used opening order(s): same symbol, opposite side, before close
    // Collect all matching opens to compute weighted average entry price
    const earliestClose = rep.placedTime
    const matchedOpens  = []
    let   openAmtNeeded = amount

    for (let j = opening.length - 1; j >= 0; j--) {
      const o = opening[j]
      if (o.symbol === rep.symbol &&
          o.side   === openSide &&
          o.placedTime <= earliestClose &&
          !usedOpenIds.has(o.orderId) &&
          openAmtNeeded > 0) {
        matchedOpens.push(o)
        usedOpenIds.add(o.orderId)
        openAmtNeeded -= isNaN(o.amount) ? 0 : o.amount
      }
    }

    // Weighted average entry price
    let totalOpenAmt = 0, weightedOpenPx = 0
    for (const o of matchedOpens) {
      const amt = isNaN(o.amount) ? 0 : o.amount
      const px  = isNaN(o.execPrice) ? 0 : o.execPrice
      weightedOpenPx += px * amt
      totalOpenAmt   += amt
    }
    const entryPrice = totalOpenAmt > 0 ? weightedOpenPx / totalOpenAmt
      : (matchedOpens[0] && !isNaN(matchedOpens[0].execPrice) ? matchedOpens[0].execPrice : null)
    const bestOpen   = matchedOpens[0] || null

    const entryTime    = bestOpen ? bestOpen.placedTime : rep.placedTime
    const exitTime     = group[group.length - 1].closedTime || rep.placedTime
    const durationMins = Math.max(0, (exitTime - entryTime) / 60000)

    // Back-solve notional from actual price move (exit/entry - 1), not broker ROI
    const { notional_usd, method: notional_method } = calculateNotionalUSD(
      pnlUsd, entryPrice, exitPrice, amount, direction
    )
    const hour    = entryTime.getUTCHours()
    const normSym = normaliseSymbol(rep.symbol)
    // Use first close orderId as position_id; append group size if multi-fill
    const posId   = group.length > 1 ? `${rep.orderId}_g${group.length}` : rep.orderId

    trades.push({
      position_id:     posId,
      account_id:      accountId,
      broker:          'PrimeXBT',
      entry_time:      entryTime.toISOString(),
      exit_time:       exitTime.toISOString(),
      symbol:          normSym,
      direction,
      size:            amount,
      entry_price:     entryPrice ? Math.round(entryPrice * 10000) / 10000 : null,
      exit_price:      exitPrice  ? Math.round(exitPrice  * 10000) / 10000 : null,
      notional_usd,
      notional_method,
      pnl:             pnlUsd,
      pct_gain:        null, // recalculated client-side from prices
      fee,
      duration_mins:   Math.round(durationMins * 10) / 10,
      currency,
      session:         getSession(hour),
      day_of_week:     entryTime.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
      tv_symbol:       getTvSymbol(normSym),
      raw_direction:   rep.side,
      order_type:      rep.orderType,
    })
  }

  return trades
}
