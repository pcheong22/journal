// lib/parsers/hyperliquid.js
// Parses Hyperliquid trades CSV exports
// Columns: time,coin,dir,px,sz,ntl,fee,feeToken,closedPnl,hash
// Opening fills: dir = Buy | Sell, closedPnl empty
// Closing fills: dir = Close Long | Close Short, closedPnl populated
// Multiple fills with same hash = same position close event

import { getSession, getTvSymbol, normaliseSymbol, calculateNotionalUSD } from '../parserUtils'

// Normalise Hyperliquid symbol names
// @107 = internal perp code (keep as-is for now, user can rename)
// xyz:COPPER → COPPER, BTC → BTC
function normaliseHLSymbol(coin) {
  if (!coin) return coin
  // Strip xyz: prefix from spot markets
  const stripped = coin.replace(/^[a-z]+:/, '')
  return normaliseSymbol(stripped)
}

export function parseHyperliquid(rows, filename, accountId) {
  const currency = 'USDC'

  // Find header row
  const headerIdx = rows.findIndex(r => r[0] === 'time' && r[1] === 'coin')
  if (headerIdx < 0) return { broker:'Hyperliquid', accountId, currency, trades:[] }

  const header = rows[headerIdx]
  const col    = name => header.indexOf(name)

  const iTime      = col('time')
  const iCoin      = col('coin')
  const iDir       = col('dir')
  const iPx        = col('px')
  const iSz        = col('sz')
  const iNtl       = col('ntl')
  const iFee       = col('fee')
  const iClosedPnl = col('closedPnl')
  const iHash      = col('hash')

  const parseNum = s => {
    const n = parseFloat(String(s || '').replace(/,/g, ''))
    return isNaN(n) ? null : n
  }

  const dataRows = rows.slice(headerIdx + 1).filter(r => r.length > 3 && r[iTime])

  // Separate opening and closing fills
  const opens  = []
  const closes = []

  dataRows.forEach(r => {
    const dir = String(r[iDir] || '').trim()
    const time = new Date(r[iTime])
    if (isNaN(time)) return

    const fill = {
      time,
      coin:      String(r[iCoin] || '').trim(),
      dir,
      px:        parseNum(r[iPx]),
      sz:        parseNum(r[iSz]),
      ntl:       parseNum(r[iNtl]),
      fee:       parseNum(r[iFee]) || 0,
      closedPnl: parseNum(r[iClosedPnl]),
      hash:      String(r[iHash] || '').trim(),
    }

    if (dir === 'Close Long' || dir === 'Close Short') closes.push(fill)
    else opens.push(fill)
  })

  // Group closing fills by hash (same hash = same position close event)
  const closeGroups = {}
  closes.forEach(c => {
    if (!closeGroups[c.hash]) closeGroups[c.hash] = []
    closeGroups[c.hash].push(c)
  })

  // Sort opens by time for matching
  opens.sort((a, b) => a.time - b.time)
  const usedOpenIdxs = new Set()

  const trades = []

  Object.values(closeGroups).forEach((group, gi) => {
    group.sort((a, b) => a.time - b.time)
    const rep       = group[0]
    const direction = rep.dir === 'Close Long' ? 'Long' : 'Short'
    const openSide  = direction === 'Long' ? 'Buy' : 'Sell'
    const coin      = rep.coin

    // Weighted average exit price
    let totalSz = 0, weightedPx = 0, totalPnl = 0, totalFee = 0
    group.forEach(c => {
      const sz = c.sz || 0
      weightedPx += (c.px || 0) * sz
      totalSz    += sz
      totalPnl   += c.closedPnl || 0
      totalFee   += Math.abs(c.fee || 0)
    })
    const exitPrice = totalSz > 0 ? weightedPx / totalSz : null
    const exitTime  = group[group.length - 1].time
    const pnlUsd    = Math.round(totalPnl * 100) / 100
    const fee       = Math.round(totalFee * 100) / 100

    // Match nearest unused opening fill: same coin, same side, before close
    let bestOpen = null
    for (let i = opens.length - 1; i >= 0; i--) {
      const o = opens[i]
      if (!usedOpenIdxs.has(i) && o.coin === coin && o.dir === openSide && o.time <= exitTime) {
        bestOpen = opens[i]; usedOpenIdxs.add(i); break
      }
    }

    const entryPrice  = bestOpen?.px || null
    const entryTime   = bestOpen ? bestOpen.time : null
    const size        = totalSz
    const durationMins = entryTime ? Math.max(0, (exitTime - entryTime) / 60000) : null
    const hour        = exitTime.getUTCHours()
    const symbol      = normaliseHLSymbol(coin)
    const positionId  = `HL_${coin}_${exitTime.getTime()}_${gi}`

    const { notional_usd, method: notional_method } = calculateNotionalUSD(
      pnlUsd, entryPrice, exitPrice, size, direction
    )

    trades.push({
      position_id:     positionId,
      account_id:      accountId,
      broker:          'Hyperliquid',
      entry_time:      entryTime?.toISOString() || null,
      exit_time:       exitTime.toISOString(),
      symbol,
      direction,
      size:            Math.round(size * 100000) / 100000,
      entry_price:     entryPrice,
      exit_price:      exitPrice ? Math.round(exitPrice * 10000) / 10000 : null,
      notional_usd,
      notional_method,
      pnl:             pnlUsd,
      pct_gain:        null,
      fee,
      duration_mins:   durationMins ? Math.round(durationMins * 10) / 10 : null,
      currency,
      session:         getSession(hour),
      day_of_week:     exitTime.toLocaleDateString('en-US', { weekday:'long', timeZone:'UTC' }),
      tv_symbol:       getTvSymbol(symbol),
      raw_direction:   rep.dir,
      order_type:      'MARKET',
    })
  })

  return { broker:'Hyperliquid', accountId, currency, trades }
}

// Detect if a file is Hyperliquid format
export function isHyperliquid(rows) {
  return rows.slice(0, 3).some(r =>
    r[0] === 'time' && r[1] === 'coin' && r[2] === 'dir' && r[3] === 'px'
  )
}
