// Reporting names are independent of exchange contracts and execution identity.
// Do not use these aliases to merge positions or average different products.
const ALIASES = {
  CRUDE:'CRUDE', WTI:'CRUDE', CL:'CRUDE', 'CL1!':'CRUDE', USOIL:'CRUDE',
  GOLD:'XAU/USD', XAU:'XAU/USD', SILVER:'XAG/USD', XAG:'XAG/USD', COPPER:'COPPER/USD',
  'NAT.GAS':'NAT.GAS', NATGAS:'NAT.GAS',
  NASDAQ:'NASDAQ', USTEC:'NASDAQ', US100:'NASDAQ',
  SP500:'SP500', US500:'SP500',
  DAX:'DAX', GER30:'DAX', GER40:'DAX', DE30:'DAX',
  DOWJ:'DOWJ', US30:'DOWJ', NIKKEI:'NIKKEI', JAPAN:'NIKKEI', JP225:'NIKKEI',
  EUR50:'EUR50', 'HK-HSI':'HK-HSI',
  USO:'USO', IBIT:'IBIT', BITO:'BITO', BITI:'BITI',
}
const COINS = ['BTC','ETH','SOL','HYPE','ADA','AVAX','LTC','XLM','XRP','ASTEROID','BNB','DOGE','LINK','MATIC','ARB','OP']
const FX = new Set(['AUDUSD','CADJPY','EURJPY','EURUSD','GBPUSD','USDCAD','USDJPY'])
const ETF = { USO:'Oil fund', IBIT:'Spot Bitcoin ETF', BITO:'Bitcoin futures ETF', BITI:'Inverse Bitcoin ETF' }

export function canonicalSymbol(value) {
  if (!value) return value
  let symbol = String(value).trim().toUpperCase().replace(/^[A-Z0-9_]+:/, '')
    .replace(/\s*\((?:PARA|XYZ)\)/g, '').replace(/\.PERP$/, '').trim()
  symbol = symbol.replace(/-(USD|USDT|USDC)$/, '/$1')
  const base = symbol.replace(/\/(USD|USDT|USDC)$/, '')
  if (ALIASES[base]) return ALIASES[base]
  // Dated WTI futures share a market, but keep the actual contract elsewhere.
  if (/^CL[FGHJKMNQUVXZ]\d{1,4}$/.test(base)) return 'CRUDE'
  if (FX.has(symbol.replace('/',''))) { const pair=symbol.replace('/',''); return `${pair.slice(0,3)}/${pair.slice(3)}` }
  for (const coin of COINS) {
    if ([coin, `${coin}USD`, `${coin}USDT`, `${coin}USDC`].includes(symbol) || base === coin) return `${coin}/USD`
  }
  symbol = symbol.replace(/\/(USDT|USDC)$/, '/USD')
  // Unknown stock/token tickers are retained until explicitly classified.
  return symbol
}

export function symbolIdentity(value, direction) {
  const symbol = canonicalSymbol(value)
  const underlying = ['CRUDE','USO'].includes(symbol) ? 'Crude oil'
    : ['BTC/USD','IBIT','BITO','BITI'].includes(symbol) ? 'Bitcoin' : symbol
  const inverse = symbol === 'BITI'
  const exposure_direction = direction === 'Long' ? (inverse ? 'Bearish' : 'Bullish')
    : direction === 'Short' ? (inverse ? 'Bullish' : 'Bearish') : null
  return { symbol, underlying, product_type: ETF[symbol] || 'Broker instrument', inverse, exposure_direction }
}

export function reportingTrade(trade) {
  const contract = [trade.original_symbol,trade.symbol,trade.tv_symbol].find(value=>/^CL[FGHJKMNQUVXZ]\d{1,4}$/i.test(value || ''))
  return { ...trade, original_symbol: trade.original_symbol || trade.symbol,
    contract_symbol: contract || null,
    ...symbolIdentity(trade.symbol, trade.direction) }
}

export function symbolReport(trades, mode = 'family') {
  const groups = new Map()
  for (const trade of trades) {
    const item = reportingTrade(trade)
    const key = mode === 'family' ? item.underlying : item.symbol
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  const stats = items => {
    const total = items.reduce((sum,item) => sum + Number(item.pnl || 0), 0)
    const comparable = items.every(item => ['USD','USDC','USDT'].includes(String(item.currency || '').toUpperCase()))
    return { count:items.length, total_pnl:comparable ? total : null,
      avg_pnl:comparable ? total/items.length : null, win_rate:items.filter(item=>item.pnl>0).length/items.length,
      bullish:items.filter(item=>item.exposure_direction==='Bullish').length,
      bearish:items.filter(item=>item.exposure_direction==='Bearish').length, comparable }
  }
  return [...groups].map(([symbol,items]) => {
    const products = new Map()
    items.forEach(item => { if (!products.has(item.symbol)) products.set(item.symbol,[]); products.get(item.symbol).push(item) })
    return {symbol,...stats(items), products:[...products].map(([name,rows])=>({symbol:name,product_type:rows[0].product_type,
      inverse:rows[0].inverse,aliases:[...new Set(rows.map(row=>row.original_symbol))],...stats(rows)}))}
  }).sort((a,b)=>(b.total_pnl ?? -Infinity)-(a.total_pnl ?? -Infinity) || a.symbol.localeCompare(b.symbol))
}
