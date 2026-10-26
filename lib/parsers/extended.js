import { occurrenceIdentity } from '../importIdentity'
// lib/parsers/extended.js
// Parses Extended (Hyperliquid-style) realized_pnl.csv exports
// Columns: market,side,size,entry_price,realised_pnl,trade_pnl,funding_fees,trading_fees,exit_price,exit_type,closed_at

import { getSession, getTvSymbol, normaliseSymbol } from '../parserUtils'

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
  const occurrences=new Map(),positionOccurrences=new Map()
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
    if (!closedAt || isNaN(closedAt) || !market || !size) return null
    return { raw:r, market, side, size, entryPrice, exitPrice, realisedPnl, tradingFees, fundingFees, exitType, closedAt, idx:i }
  }).filter(Boolean).sort((a,b)=>a.closedAt-b.closedAt || a.market.localeCompare(b.market) || a.side.localeCompare(b.side) || JSON.stringify(a.raw).localeCompare(JSON.stringify(b.raw)))
  for(const fill of fills){
    fill.source=occurrenceIdentity('EXTROW',fill.raw,occurrences)
    fill.positionId=occurrenceIdentity('EXT',[fill.market,fill.side,fill.closedAt.toISOString()],positionOccurrences)
  }
  const lastByLegacy=new Map()
  for(const fill of fills)lastByLegacy.set(`${fill.market}|${fill.side}|${fill.closedAt.toISOString().slice(0,10)}`,fill)

  // Each row is an independently reported realised close. Grouping by UTC day
  // merged unrelated round trips and fabricated average prices and durations.
  const trades = fills.map(fill => {
    const {market,side,size,entryPrice,exitPrice,realisedPnl,tradingFees,fundingFees,exitType,closedAt,source,positionId}=fill
    const direction=side==='LONG'?'Long':'Short',sourcePrice=entryPrice || exitPrice
    const notional_usd=sourcePrice>0&&size>0?Math.round(sourcePrice*size*100)/100:null
    const legacyKey=`${market}|${side}|${closedAt.toISOString().slice(0,10)}`
    const legacyPosition=`EXT_${market}_${side}_${closedAt.toISOString().slice(0,10)}`
    const symbol=normaliseSymbol(market.replace('-', '/'))

    return {
      position_id:     positionId,
      _legacy_position_id:lastByLegacy.get(legacyKey)===fill?legacyPosition:null,
      _source_ids:     [source],
      account_id:      accountId,
      broker:          'Extended',
      entry_time:      null,
      exit_time:       closedAt.toISOString(),
      symbol,
      direction,
      size:            Math.round(size * 1e8) / 1e8,
      entry_price:     entryPrice==null?null:Math.round(entryPrice * 1e8) / 1e8,
      exit_price:      exitPrice==null?null:Math.round(exitPrice * 1e8) / 1e8,
      notional_usd,
      notional_method:notional_usd==null?null:'price_x_size',
      pnl:             Math.round((realisedPnl || 0) * 100) / 100,
      pct_gain:        null,
      fee:             Math.round((Math.abs(tradingFees)+Math.abs(fundingFees))*100)/100,
      duration_mins:   null,
      currency,
      session:         getSession(closedAt.getUTCHours()),
      day_of_week:     closedAt.toLocaleDateString('en-US', { weekday:'long', timeZone:'UTC' }),
      tv_symbol:       getTvSymbol(symbol),
      raw_direction:   side,
      order_type:      exitType || 'TRADE',
    }
  })

  return { broker:'Extended', accountId, currency, trades }
}
