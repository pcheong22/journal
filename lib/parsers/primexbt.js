// lib/parsers/primexbt.js
// Parses PrimeXBT orders CSV export
// Filename format: YYYY-MM-DD_ACCOUNTID_CURRENCY_orders.csv
// e.g. 2026-05-08_L259832_USDC_orders.csv

import { getSession, getTvSymbol, normaliseSymbol, parseDate } from '../parserUtils'

export function extractPrimeXBTMeta(filename) {
  const fn = filename.replace(/\.csv$/i,'')
  const match=fn.match(/^(?:\d{4}-\d{2}-\d{2}_)?([A-Za-z0-9]+)_(USDC|USDT|USD|BTC|ETH)_orders?$/i)
  if (!match) return {accountId:null,currency:null,legacyAccountId:null}
  const currency=match[2].toUpperCase()
  // Historical journal accounts were keyed by settlement currency (USDC/USDT),
  // while current filenames also carry the broker account ID. Keep both so a
  // dated export resolves to the existing account instead of creating a duplicate.
  return {accountId:match[1],currency,legacyAccountId:currency}

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
  const unique = new Map()
  for (const order of all) {
    if (unique.has(order.orderId) && JSON.stringify(unique.get(order.orderId)) !== JSON.stringify(order)) throw new Error('Conflicting PrimeXBT rows share an order ID. Export a complete, consistent history.')
    unique.set(order.orderId,order)
  }
  const uniqueOrders=[...unique.values()]
  // Retain each broker-reported realised close. A time window cannot prove that
  // adjacent orders belong to one position: separate round trips often occur only
  // minutes apart. Presentation may consolidate tranches later without rewriting
  // the source ledger.
  const ordered=[...uniqueOrders].sort((a,b)=>a.placedTime-b.placedTime || a.orderId.localeCompare(b.orderId))
  // Identify which atomic close inherits an older parser's 30-minute aggregate.
  // The final close owns the legacy row so the earlier closes can be inserted and
  // the aggregate can be replaced without duplicating its P&L.
  const legacyOwners=new Map(),legacyMembers=new Set(),legacyActive=new Map(),legacyGroups=[]
  for(const close of ordered.filter(row=>!isNaN(row.pnlRaw)&&row.pnlRaw!==0)){
    const key=close.symbol+'|'+close.side
    let group=legacyActive.get(key)
    if(!group||close.placedTime-group[0].placedTime>30*60*1000){group=[];legacyGroups.push(group);legacyActive.set(key,group)}
    group.push(close)
  }
  for(const group of legacyGroups){
    const legacyId=group[0].orderId
    legacyOwners.set(group[group.length-1].orderId,legacyId)
    if(group.length>1)group.forEach(row=>legacyMembers.add(row.orderId))
  }
  const trades=[],openingPools=new Map(),epsilon=1e-10
  for (const rep of ordered) {
    const isClose=!isNaN(rep.pnlRaw) && rep.pnlRaw!==0
    if(!isClose){
      const key=rep.symbol+'|'+rep.side
      if(!openingPools.has(key))openingPools.set(key,[])
      openingPools.get(key).push({...rep,remainingAmount:Number.isFinite(rep.amount)?rep.amount:0,remainingFee:Number.isFinite(rep.fee)?Math.abs(rep.fee):0})
      continue
    }
    const direction = rep.side === 'SELL' ? 'Long' : 'Short'
    const openSide  = rep.side === 'SELL' ? 'BUY'  : 'SELL'
    const amount=Number.isFinite(rep.amount)?rep.amount:0,exitPrice=Number.isFinite(rep.execPrice)?rep.execPrice:null
    const matchedOpens=[],pool=openingPools.get(rep.symbol+'|'+openSide) || []
    let openAmtNeeded=amount,openingFee=0
    while(openAmtNeeded>epsilon && pool.length){
      const lot=pool[pool.length-1]
      if(!(lot.remainingAmount>epsilon)){pool.pop();continue}
      const used=Math.min(openAmtNeeded,lot.remainingAmount),ratio=used/lot.remainingAmount
      const allocatedFee=lot.remainingFee*ratio
      matchedOpens.push({...lot,amount:used,allocatedFee})
      lot.remainingAmount-=used;lot.remainingFee-=allocatedFee;openAmtNeeded-=used;openingFee+=allocatedFee
      if(lot.remainingAmount<=epsilon)pool.pop()
    }
    const complete=amount>0&&openAmtNeeded<=epsilon
    const totalOpenAmt=matchedOpens.reduce((sum,row)=>sum+row.amount,0)
    const entryPrice=complete&&totalOpenAmt>0
      ? matchedOpens.reduce((sum,row)=>sum+row.execPrice*row.amount,0)/totalOpenAmt:null
    const entryTime=complete?matchedOpens.reduce((earliest,row)=>!earliest||row.placedTime<earliest?row.placedTime:earliest,null):null
    const exitTime=rep.closedTime || rep.placedTime
    const durationMins=entryTime?Math.max(0,(exitTime-entryTime)/60000):null
    const sourcePrice=entryPrice || exitPrice
    const notional_usd=sourcePrice>0&&amount>0?Math.round(sourcePrice*amount*100)/100:null
    const notional_method=notional_usd==null?null:'price_x_size'
    const pnlUsd=Math.round(rep.pnlRaw*100)/100
    const fee=Math.round(((Number.isFinite(rep.fee)?Math.abs(rep.fee):0)+openingFee)*100)/100
    const hour=(entryTime || exitTime).getUTCHours()
    const normSym=normaliseSymbol(rep.symbol)
    const posId=rep.orderId

    trades.push({
      position_id:     posId,
      _legacy_position_id:legacyOwners.get(rep.orderId) || null,
      _legacy_grouped:legacyMembers.has(rep.orderId),
      _source_ids:     [rep,...matchedOpens].map(order=>'pxt:'+order.orderId).sort(),
      account_id:      accountId,
      broker:          'PrimeXBT',
      entry_time:      entryTime?.toISOString() || null,
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
      duration_mins:   durationMins==null?null:Math.round(durationMins * 10) / 10,
      currency,
      session:         getSession(hour),
      day_of_week:     (entryTime || exitTime).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
      tv_symbol:       getTvSymbol(normSym),
      raw_direction:   rep.side,
      order_type:      rep.orderType,
    })
  }

  return trades
}
