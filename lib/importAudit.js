const number=value=>{const text=String(value??'').replace(/,/g,'').replace(/\s+[A-Za-z]+$/,'').trim();if(!text || ['--','N/A'].includes(text))return null;const n=Number(text);return Number.isFinite(n)?n:null}
export function importAudit(rows,parsed) {
 const parsedTotals={};for(const trade of parsed.trades)if(Number.isFinite(trade.pnl))parsedTotals[trade.currency || parsed.currency]=(parsedTotals[trade.currency || parsed.currency] || 0)+trade.pnl
 const sourceTotals={},fees={};let eligible=0,available=true
 const add=(currency,pnl,fee=0)=>{if(pnl==null)throw new Error('An eligible source record has invalid P&L. No trades changed.');sourceTotals[currency]=(sourceTotals[currency] || 0)+pnl;fees[currency]=(fees[currency] || 0)+(fee || 0);eligible++}
 if(parsed.hypurrscan)available=false
 else if(parsed.broker==='TxFlow'){
  const index=rows.findIndex(row=>row.includes('Closed PnL')&&row.includes('Filled Amount')),h=rows[index];
  for(const row of rows.slice(index+1).filter(row=>row.some(Boolean)))add('USDC',number(row[h.indexOf('Closed PnL')]),number(row[h.indexOf('Fee')]))
  for(const currency of Object.keys(sourceTotals))sourceTotals[currency]-=fees[currency]
 }else if(parsed.broker==='Hyperliquid'){
  const index=rows.findIndex(row=>row[0]==='time'&&row[1]==='coin'),h=rows[index]
  for(const row of rows.slice(index+1))if(['Close Long','Close Short','Sell'].includes(row[h.indexOf('dir')]))add('USDC',number(row[h.indexOf('closedPnl')]),number(row[h.indexOf('fee')]))
 }else if(parsed.broker==='PrimeXBT'){
  const index=rows.findIndex(row=>row.some(cell=>String(cell).toLowerCase().includes('order id'))),h=rows[index].map(cell=>String(cell).toLowerCase())
  const at=key=>h.findIndex(cell=>cell.includes(key)),seen=new Set()
  for(const row of rows.slice(index+1))if(['EXECUTED','PARTIAL_EXECUTED'].includes(row[at('status')])&&!seen.has(row[at('order id')])){seen.add(row[at('order id')]);const pnl=number(row[at('round settled p/l')]);if(pnl!==null&&pnl!==0)add(parsed.currency,pnl,number(row[at('fee')]))}
 }else if(parsed.broker==='Extended'){
  const index=rows.findIndex(row=>row[0]==='market'&&row[1]==='side'),h=rows[index]
  for(const row of rows.slice(index+1))if(row[h.indexOf('market')])add(parsed.currency,number(row[h.indexOf('realised_pnl')]),number(row[h.indexOf('trading_fees')]))
 }else if(parsed.broker==='IBKR'){
  const h=rows.find(row=>row[0]==='Trades'&&row[1]==='Header')
  for(const row of rows)if(row[0]==='Trades'&&row[1]==='Data'&&row[h.indexOf('DataDiscriminator')]==='Order'&&row[h.indexOf('Asset Category')]!=='Forex'&&String(row[h.indexOf('Code')]).includes('C'))add(row[h.indexOf('Currency')] || 'USD',number(row[h.indexOf('Realized P/L')]),number(row[h.indexOf('Comm/Fee')]))
 }else if(parsed.broker==='Bybit'){
  const index=rows.findIndex(row=>row[0]==='symbol'&&row.includes('pnl')),h=rows[index]
  for(const row of rows.slice(index+1))if(row[0])add(row[h.indexOf('currency')] || parsed.currency,number(row[h.indexOf('pnl')]),h.includes('fee')?number(row[h.indexOf('fee')]):0)
 }else available=false
 const totals=Object.keys({...sourceTotals,...parsedTotals}).map(currency=>({currency,source:available?sourceTotals[currency] || 0:null,parsed:parsedTotals[currency] || 0,fees:fees[currency] || 0,difference:available?(parsedTotals[currency] || 0)-(sourceTotals[currency] || 0):null}))
 const tolerance=Math.max(.011,parsed.trades.length*.0051)
 const matched=available&&totals.every(total=>Math.abs(total.difference)<=tolerance)
 return {available,matched,eligible,totals,tolerance,scope:parsed.broker==='TxFlow'?'Exported Closed PnL less exported trading fees; funding excluded':'Eligible export rows only; deposits, funding and account-statement totals are not fully represented'}
}
