// lib/parsers/extended.js
// Parses Extended (Hyperliquid-style) realized_pnl.csv exports
// Columns: market,side,size,entry_price,realised_pnl,trade_pnl,funding_fees,trading_fees,exit_price,exit_type,closed_at

import { getSession, getTvSymbol, normaliseSymbol, calculateNotionalUSD } from '../parserUtils'

export function parseExtended(rows, filename, accountIdOverride) {
  const accountId = accountIdOverride || 'EXTENDED_DEFAULT'
  const currency  = 'USD'

  // Find header row
  const headerIdx = rows.findIndex(r => r[0] === 'market' && r[1] === 'side')
  if (headerIdx < 0) return { broker:'Extended', accountId, currency, trades:[] }

  const header = rows[headerIdx]
  const col    = name => header.indexOf(name)

  const iMarket      = col('market')
  const iSide        = col('side')
  const iSize        = col('size')
  const iEntryPrice  = col('entry_price')
  const iRealPnl     = col('realised_pnl')
  const iTradePnl    = col('trade_pnl')
  const iFundingFees = col('funding_fees')
  const iTradingFees = col('trading_fees')
  const iExitPrice   = col('exit_price')
  const iExitType    = col('exit_type')
  const iClosedAt    = col('closed_at')

  const parseNum = s => {
    const n = parseFloat(String(s || '').replace(/,/g, ''))
    return isNaN(n) ? null : n
  }

  const dataRows = rows.slice(headerIdx + 1).filter(r => r.length > 3 && r[iMarket])

  // Parse all rows first
  const fills = dataRows.map((r, i) => {
    const market      = String(r[iMarket] || '').trim()
    const side        = String(r[iSide]   || '').toUpperCase()
    const size        = parseNum(r[iSize])
    const entryPrice  = parseNum(r[iEntryPrice])
    const exitPrice   = parseNum(r[iExitPrice])
    const realisedPnl = parseNum(r[iRealPnl])
    const tradingFees = parseNum(r[iTradingFees]) || 0
    const fundingFees = parseNum(r[iFundingFees]) || 0
    const exitType    = String(r[iExitType] || '').trim()
    const closedAt    = r[iClosedAt] ? new Date(r[iClosedAt]) : null
    if (!closedAt || !market || size == null) return null
    return { market, side, size, entryPrice, exitPrice, realisedPnl, tradingFees, fundingFees, exitType, closedAt, idx:i }
  }).filter(Boolean)

  // Group by market + side + calendar day
  const groups = {}
  fills.forEach(f => {
    const day = f.closedAt.toISOString().slice(0, 10)
    const key = `${f.market}|${f.side}|${day}`
    if (!groups[key]) groups[key] = []
    groups[key].push(f)
  })

  // Consolidate each group into one trade
  const trades = Object.entries(groups).map(([key, gFills]) => {
    gFills.sort((a, b) => a.closedAt - b.closedAt)
    const last       = gFills[gFills.length - 1]
    const market     = gFills[0].market
    const side       = gFills[0].side
    const direction  = side === 'LONG' ? 'Long' : 'Short'

    // Weighted average entry and exit prices
    const totalSize    = gFills.reduce((s, f) => s + (f.size || 0), 0)
    const wavgEntry    = gFills.reduce((s, f) => s + (f.entryPrice || 0) * (f.size || 0), 0) / totalSize
    const wavgExit     = gFills.reduce((s, f) => s + (f.exitPrice  || 0) * (f.size || 0), 0) / totalSize
    const totalPnl     = gFills.reduce((s, f) => s + (f.realisedPnl || 0), 0)
    const totalFee     = gFills.reduce((s, f) => s + Math.abs(f.tradingFees) + Math.abs(f.fundingFees), 0)

    const symbol   = normaliseSymbol(market.replace('-', '/'))
    const pnlUsd   = Math.round(totalPnl * 100) / 100
    const exitTime  = last.closedAt
    const entryTime = gFills[0].closedAt // earliest fill — approx entry time
    const durationMins = Math.max(0, (exitTime - entryTime) / 60000)
    const hour      = exitTime.getUTCHours()

    const { notional_usd, method: notional_method } = calculateNotionalUSD(
      pnlUsd, wavgEntry, wavgExit, totalSize, direction
    )

    const positionId = `EXT_${market}_${side}_${exitTime.toISOString().slice(0,10)}`

    return {
      position_id:     positionId,
      account_id:      accountId,
      broker:          'Extended',
      entry_time:      entryTime.toISOString(),
      exit_time:       exitTime.toISOString(),
      symbol,
      direction,
      size:            Math.round(totalSize * 1e8) / 1e8,
      entry_price:     Math.round(wavgEntry * 100) / 100 || null,
      exit_price:      Math.round(wavgExit  * 100) / 100 || null,
      notional_usd,
      notional_method,
      pnl:             pnlUsd,
      pct_gain:        null,
      fee:             Math.round(totalFee * 100) / 100,
      duration_mins:   Math.round(durationMins * 10) / 10 || null,
      currency,
      session:         getSession(hour),
      day_of_week:     exitTime.toLocaleDateString('en-US', { weekday:'long', timeZone:'UTC' }),
      tv_symbol:       getTvSymbol(symbol),
      raw_direction:   side,
      order_type:      gFills[0].exitType || 'TRADE',
    }
  })

  return { broker:'Extended', accountId, currency, trades }
}
