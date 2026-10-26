import { occurrenceIdentity } from '../importIdentity'
// lib/parsers/ibkr.js
// Parses IBKR Activity Statement CSV exports
// Format: multi-section CSV where each row starts with section name
// Trades rows: Trades,Data,Order,{AssetCategory},{Currency},{Symbol},{DateTime},{Qty},{Price},...,{RealizedPL},...,{Code}

import { getSession, getTvSymbol, normaliseSymbol, parseDate, calculateNotionalUSD } from '../parserUtils'

export function parseIBKR(rows, filename, accountIdOverride) {
  // Extract account ID from filename (e.g. U11154227_20260101_20260508.csv)
  const fileAccMatch = filename.match(/^([UF]\d+)_/)
  const accountId    = accountIdOverride || (fileAccMatch ? fileAccMatch[1] : 'IBKR_DEFAULT')
  const currency     = 'USD'

  // Find the Trades header row to get column indices
  const headerRow = rows.find(r => r[0] === 'Trades' && r[1] === 'Header')
  if (!headerRow) return { broker:'IBKR', accountId, currency, trades:[] }

  // Build column index map
  const col = name => headerRow.indexOf(name)
  const iDiscriminator = col('DataDiscriminator')  // 'Order' vs 'SubTotal' etc
  const iAssetCat      = col('Asset Category')
  const iCurrency      = col('Currency')
  const iSymbol        = col('Symbol')
  const iDateTime      = col('Date/Time')
  const iQty           = col('Quantity')
  const iPrice         = col('T. Price')           // transaction price
  const iProceeds      = col('Proceeds')
  const iFee           = col('Comm/Fee')
  const iBasis         = col('Basis')
  const iRealizedPL    = col('Realized P/L')
  const iCode          = col('Code')

  // Extract all trade order rows (not subtotals, not totals)
  const orderRows = rows.filter(r =>
    r[0] === 'Trades' &&
    r[1] === 'Data' &&
    r[iDiscriminator] === 'Order' &&
    r[iAssetCat] !== 'Forex'  // skip FX conversion rows for now
  )

  if (!orderRows.length) return { broker:'IBKR', accountId, currency, trades:[] }

  // Parse each row into a normalised order object
  const parseNum = s => {
    if (!s || s === '--' || s === '') return NaN
    return parseFloat(String(s).replace(/,/g,'').replace(/"/g,''))
  }

  const parseDateTime = s => {
    // Format: "2026-03-12, 03:01:23" or 2026-03-12, 03:01:23
    const clean = String(s).replace(/"/g,'').trim()
    const match = clean.match(/(\d{4}-\d{2}-\d{2}),?\s+(\d{2}:\d{2}:\d{2})/)
    if (!match) return null
    return new Date(`${match[1]}T${match[2]}Z`)
  }

  const orders = orderRows.map(r => {
    const code     = String(r[iCode] || '')
    const isOpen   = code.includes('O')
    const isClose  = code.includes('C')
    const qty      = parseNum(r[iQty])
    const price    = parseNum(r[iPrice])
    const fee      = parseNum(r[iFee]) || 0
    const realPL   = parseNum(r[iRealizedPL])
    const basis    = parseNum(r[iBasis])
    const dateTime = parseDateTime(r[iDateTime])
    const symbol   = String(r[iSymbol] || '').trim()
    const assetCat = String(r[iAssetCat] || '').trim()

    return { symbol, assetCat, currency:String(r[iCurrency] || 'USD'), qty, price, fee, realPL, basis, dateTime, isOpen, isClose, code }
  }).filter(o => o.dateTime && o.symbol)

  // ── Match opens to closes by symbol ──────────────────────────────────────
  // Group by symbol, then pair opening rows with closing rows chronologically
  const bySymbol = {}
  orders.forEach(o => {
    const key=[o.symbol,o.assetCat,o.currency].join('|')
    if (!bySymbol[key]) bySymbol[key] = { opens:[], closes:[] }
    if (o.isClose && !isNaN(o.realPL)) bySymbol[key].closes.push(o)
    else if (o.isOpen) bySymbol[key].opens.push({...o,remaining:Math.abs(o.qty)})
  })

  const trades = []
  const occurrences = new Map()
  const usedOpenIdxs = {}

  for (const groupKey of Object.keys(bySymbol)) {
    const { opens, closes } = bySymbol[groupKey]
    const symbol=closes[0]?.symbol || opens[0]?.symbol
    opens.sort((a,b) => a.dateTime - b.dateTime)
    closes.sort((a,b) => a.dateTime - b.dateTime)
    for (const close of closes) {
      // Closing-record identity is independent of this inferred FIFO allocation.
      let needed=Math.abs(close.qty), value=0, openingFee=0, entryTime=null
      for (const open of opens) {
        if (needed<=1e-10) break
        if (!open.remaining || open.dateTime>close.dateTime || Math.sign(open.qty)===Math.sign(close.qty)) continue
        const used=Math.min(needed,open.remaining)
        value+=used*open.price;openingFee+=Math.abs(open.fee || 0)*used/Math.abs(open.qty)
        open.remaining-=used;needed-=used
        if (!entryTime) entryTime=open.dateTime
      }
      const complete=needed<=Math.max(1,Math.abs(close.qty))*1e-10
      const entryPrice=complete ? value/Math.abs(close.qty) : null
      if (!complete) entryTime=null
      const exitTime=close.dateTime
      const exitPrice  = close.price
      const size       = Math.abs(close.qty)
      const pnlUsd     = Math.round(close.realPL * 100) / 100
      const fee        = Math.abs(close.fee || 0) + openingFee

      // Direction: positive qty open = Long, negative = Short
      // For closing: negative qty = sold (closing Long), positive = bought (closing Short)
      const direction = close.qty < 0 ? 'Long' : 'Short'

      // Back-solve notional
      const { notional_usd, method: notional_method } = calculateNotionalUSD(
        pnlUsd, entryPrice, exitPrice, size, direction
      )

      const hour        = (entryTime || exitTime).getUTCHours()
      const normSym     = normaliseSymbol(symbol)
      const positionId  = occurrenceIdentity('IBKR2',[symbol,close.assetCat,close.currency,close.dateTime.toISOString(),close.qty,close.price,close.realPL,close.fee,close.code],occurrences)

      trades.push({
        position_id:     positionId,
        _source_ids: [positionId],
        account_id:      accountId,
        broker:          'IBKR',
        entry_time:      entryTime?.toISOString() || null,
        exit_time:       exitTime.toISOString(),
        symbol:          normSym,
        direction,
        size,
        entry_price:     entryPrice,
        exit_price:      exitPrice,
        notional_usd,
        notional_method,
        pnl:             pnlUsd,
        pct_gain:        null,
        fee:             Math.round(fee * 100) / 100,
        duration_mins:   entryTime ? Math.max(0, Math.round((exitTime - entryTime) / 60000 * 10) / 10) : null,
        currency:close.currency,
        session:         getSession(hour),
        day_of_week:     (entryTime || exitTime).toLocaleDateString('en-US', { weekday:'long', timeZone:'UTC' }),
        tv_symbol:       getTvSymbol(normSym),
        raw_direction:   close.qty < 0 ? 'SELL' : 'BUY',
        order_type:      'LIMIT',
      })
    }
  }

  return { broker:'IBKR', accountId, currency, trades }
}
