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

  const trades = dataRows.map((r, i) => {
    const market      = String(r[iMarket] || '').trim()
    const side        = String(r[iSide] || '').toUpperCase()
    const direction   = side === 'LONG' ? 'Long' : 'Short'
    const size        = parseNum(r[iSize])
    const entryPrice  = parseNum(r[iEntryPrice])
    const exitPrice   = parseNum(r[iExitPrice])
    const realisedPnl = parseNum(r[iRealPnl])
    const tradePnl    = parseNum(r[iTradePnl])
    const fundingFees = parseNum(r[iFundingFees]) || 0
    const tradingFees = parseNum(r[iTradingFees]) || 0
    const exitType    = String(r[iExitType] || '').trim()
    const closedAt    = r[iClosedAt] ? new Date(r[iClosedAt]) : null

    if (!closedAt || !market || size == null) return null

    // Normalise symbol: BTC-USD → BTC/USD
    const symbol  = normaliseSymbol(market.replace('-', '/'))
    const pnlUsd  = realisedPnl != null ? Math.round(realisedPnl * 100) / 100 : null
    const fee     = Math.abs(tradingFees)  // store trading fees in fee column
    const hour    = closedAt.getUTCHours()

    // Back-solve notional
    const { notional_usd, method: notional_method } = calculateNotionalUSD(
      pnlUsd, entryPrice, exitPrice, size, direction
    )

    // Position ID: market + entry + exit timestamp millis
    const positionId = `EXT_${market}_${closedAt.getTime()}_${i}`

    return {
      position_id:     positionId,
      account_id:      accountId,
      broker:          'Extended',
      entry_time:      null,           // Extended doesn't provide entry timestamp
      exit_time:       closedAt.toISOString(),
      symbol,
      direction,
      size,
      entry_price:     entryPrice,
      exit_price:      exitPrice,
      notional_usd,
      notional_method,
      pnl:             pnlUsd,
      pct_gain:        null,           // calculated client-side from prices
      fee,
      funding_fee:     Math.round(fundingFees * 100) / 100, // stored separately
      duration_mins:   null,           // no entry timestamp available
      currency,
      session:         getSession(hour),
      day_of_week:     closedAt.toLocaleDateString('en-US', { weekday:'long', timeZone:'UTC' }),
      tv_symbol:       getTvSymbol(symbol),
      raw_direction:   side,
      order_type:      exitType || 'TRADE',
    }
  }).filter(Boolean)

  return { broker:'Extended', accountId, currency, trades }
}
