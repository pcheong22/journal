// lib/parsers/bybit-spot.js
// Parses Bybit Spot Trade History CSV exports
// Columns: Spot Pairs, Order Type, Direction, feeCoin, ExecFeeV2, Filled Value,
//          Filled Price, Filled Quantity, Fees, Transaction ID, Order No., Timestamp (UTC)
// Date format: "16:12 2024-11-09" (HH:MM YYYY-MM-DD)
// Strategy: group fills by Order No, then match SELLs to BUYs per symbol
//           using average cost basis for entry price

import { getSession, getTvSymbol, normaliseSymbol, calculateNotionalUSD } from '../parserUtils'

function parseBybitDate(s) {
  s = String(s || '').trim()
  // Format: "16:12 2024-11-09"
  const m = s.match(/^(\d{2}:\d{2})\s+(\d{4}-\d{2}-\d{2})/)
  if (m) return new Date(`${m[2]}T${m[1]}:00Z`)
  return new Date(s)
}

function normaliseBybitSymbol(pair) {
  // SOLUSDT → SOL/USDT, BTCUSDC → BTC/USDC, ETHBTC → ETH/BTC
  const stables = ['USDT','USDC','BTC','ETH','BNB']
  for (const q of stables) {
    if (pair.endsWith(q) && pair.length > q.length) {
      const base = pair.slice(0, pair.length - q.length)
      return normaliseSymbol(`${base}/${q}`)
    }
  }
  return normaliseSymbol(pair)
}

export function parseBybitSpot(rows, filename, accountId) {
  const currency = 'USDT'

  // Find header row
  const headerIdx = rows.findIndex(r =>
    r[0] === 'Spot Pairs' && r[2] === 'Direction'
  )
  if (headerIdx < 0) return { broker:'Bybit', accountId, currency, trades:[] }

  const header    = rows[headerIdx]
  const col       = name => header.findIndex(h => h.trim() === name.trim())
  const iPair     = col('Spot Pairs')
  const iType     = col('Order Type')
  const iDir      = col('Direction')
  const iValue    = col('Filled Value')
  const iPrice    = col('Filled Price')
  const iQty      = col('Filled Quantity')
  const iFee      = col('Fees')
  const iFeeV2    = col('ExecFeeV2')
  const iOrderNo  = col('Order No.')
  const iTime     = col('Timestamp (UTC)')

  const parseNum = s => {
    const n = parseFloat(String(s || '').replace(/,/g, ''))
    return isNaN(n) || !isFinite(n) ? 0 : n
  }

  const dataRows = rows.slice(headerIdx + 1).filter(r => r[iPair] && r[iPair].trim())

  // ── Step 1: Group fills by Order No + Symbol ─────────────────────────────
  const orderMap = {}
  dataRows.forEach(r => {
    const pair    = r[iPair].trim()
    const orderNo = r[iOrderNo].trim()
    const key     = `${pair}|${orderNo}`
    if (!orderMap[key]) orderMap[key] = []
    orderMap[key].push(r)
  })

  // ── Step 2: Consolidate fills into orders ────────────────────────────────
  const orders = Object.values(orderMap).map(fills => {
    fills.sort((a, b) => parseBybitDate(a[iTime]) - parseBybitDate(b[iTime]))
    const pair  = fills[0][iPair].trim()
    const dir   = fills[0][iDir].trim()
    let totalQty = 0, totalVal = 0, totalFee = 0

    fills.forEach(r => {
      const qty = parseNum(r[iQty])
      const val = parseNum(r[iValue])
      const fee = parseNum(r[iFee]) || parseNum(r[iFeeV2]) || 0
      totalQty += qty
      totalVal += val
      totalFee += Math.abs(fee)
    })

    const avgPrice = totalQty > 0 ? totalVal / totalQty : 0
    const time     = parseBybitDate(fills[fills.length - 1][iTime])

    return { pair, dir, totalQty, totalVal, totalFee, avgPrice, time, orderNo: fills[0][iOrderNo].trim() }
  })

  // Sort by time
  orders.sort((a, b) => a.time - b.time)

  // ── Step 3: Average cost basis per symbol ────────────────────────────────
  // costBasis[symbol] = { qty, totalCost } — running average
  const costBasis = {}
  const trades    = []

  orders.forEach((order, idx) => {
    const symbol = order.pair
    if (!costBasis[symbol]) costBasis[symbol] = { qty: 0, totalCost: 0 }

    if (order.dir === 'BUY') {
      // Add to cost basis
      costBasis[symbol].qty       += order.totalQty
      costBasis[symbol].totalCost += order.totalVal
    } else if (order.dir === 'SELL') {
      // Calculate P&L using average cost
      const avgCost    = costBasis[symbol].qty > 0
        ? costBasis[symbol].totalCost / costBasis[symbol].qty
        : null
      const proceeds   = order.totalVal
      const costOfSold = avgCost != null ? avgCost * order.totalQty : null
      const pnlUsd     = costOfSold != null
        ? Math.round((proceeds - costOfSold - order.totalFee) * 100) / 100
        : null

      // Reduce cost basis
      if (costBasis[symbol].qty > 0) {
        const ratio = Math.min(1, order.totalQty / costBasis[symbol].qty)
        costBasis[symbol].totalCost *= (1 - ratio)
        costBasis[symbol].qty        = Math.max(0, costBasis[symbol].qty - order.totalQty)
      }

      const entryPrice  = avgCost
      const exitPrice   = order.avgPrice
      const normSymbol  = normaliseBybitSymbol(symbol)
      const hour        = order.time.getUTCHours()
      const positionId  = `BYBIT_SPOT_${symbol}_${order.time.getTime()}_${idx}`

      const notional_usd    = order.totalVal
      const notional_method = 'price_x_size'

      trades.push({
        position_id:     positionId,
        account_id:      accountId,
        broker:          'Bybit',
        entry_time:      null,           // spot — no clear entry time
        exit_time:       order.time.toISOString(),
        symbol:          normSymbol,
        direction:       'Long',         // spot buys are always long
        size:            Math.round(order.totalQty * 1e8) / 1e8,
        entry_price:     entryPrice ? Math.round(entryPrice * 1e6) / 1e6 : null,
        exit_price:      Math.round(exitPrice * 1e6) / 1e6,
        notional_usd:    Math.round(notional_usd * 100) / 100,
        notional_method,
        pnl:             pnlUsd,
        pct_gain:        null,
        fee:             Math.round(order.totalFee * 100) / 100,
        duration_mins:   null,
        currency,
        session:         getSession(hour),
        day_of_week:     order.time.toLocaleDateString('en-US', { weekday:'long', timeZone:'UTC' }),
        tv_symbol:       getTvSymbol(normSymbol),
        raw_direction:   'SELL',
        order_type:      'SPOT',
      })
    }
  })

  return { broker:'Bybit', accountId, currency, trades }
}

export function isBybitSpot(rows) {
  return rows.slice(0, 3).some(r =>
    r[0] === 'Spot Pairs' && r[2] === 'Direction'
  )
}
