import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
const url=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const {canonicalSymbol,symbolIdentity,reportingTrade,symbolReport}=await import(url(await readFile(new URL('../lib/symbols.js',import.meta.url),'utf8')))

test('oil aliases, case, quote suffixes and dated contracts share CRUDE',()=>{
 for(const alias of ['CRUDE','crude/usd','CRUDE/USDT','WTI/USD','WTI-USDC','CL','CLJ6','CLZ2026','CL1!','USOIL'])assert.equal(canonicalSymbol(alias),'CRUDE',alias)
 assert.equal(canonicalSymbol('BRENT'),'BRENT')
 assert.equal(canonicalSymbol('AAPL'),'AAPL')
 assert.equal(canonicalSymbol('USO'),'USO')
})

test('known metals and indices normalise idempotently without spurious USD names',()=>{
 const groups={'XAU/USD':['GOLD','gold/usd','XAU/USD'],'XAG/USD':['SILVER','SILVER/USD'],'COPPER/USD':['COPPER (xyz)','xyz:COPPER','COPPER/USD'],NASDAQ:['USTEC','NASDAQ','NASDAQ/USD'],SP500:['US500','SP500/USD'],DAX:['GER30','GER40','DE30','DAX/USD'],DOWJ:['US30','DOWJ/USD'],NIKKEI:['JAPAN','JP225','NIKKEI/USD'],EUR50:['EUR50','EUR50/USD'],'HK-HSI':['HK-HSI','HK-HSI/USD'],'NAT.GAS':['NAT.GAS','NAT.GAS/USD']}
 for(const [expected,aliases] of Object.entries(groups))for(const alias of aliases){assert.equal(canonicalSymbol(alias),expected);assert.equal(canonicalSymbol(canonicalSymbol(alias)),expected)}
})

test('crypto quote variants consolidate while products and FX stay distinct',()=>{
 for(const alias of ['BTC','btcusdt','BTC/USDC','BTC-USD','BTC.PERP'])assert.equal(canonicalSymbol(alias),'BTC/USD')
 for(const symbol of ['IBIT','BITI','BITO','USO','EUR/USD','CAD/JPY'])assert.equal(canonicalSymbol(symbol),symbol)
 assert.equal(canonicalSymbol('eurusd'),'EUR/USD')
 assert.notEqual(canonicalSymbol('ASTEROID (CHAIN-A)'),canonicalSymbol('ASTEROID (CHAIN-B)'))
})

test('inverse product exposure is independent of trade direction',()=>{
 assert.equal(symbolIdentity('BITI','Long').exposure_direction,'Bearish')
 assert.equal(symbolIdentity('BITI','Short').exposure_direction,'Bullish')
 assert.equal(symbolIdentity('IBIT','Long').exposure_direction,'Bullish')
 assert.equal(symbolIdentity('BITO','Short').exposure_direction,'Bearish')
 assert.equal(symbolIdentity('USO','Long').underlying,'Crude oil')
})

test('reporting preserves stored tickers and execution identity without mutating records',()=>{
 const trade={id:1,position_id:'unchanged',symbol:'crude/usd',entry_price:100,size:2,pnl:20,direction:'Long'}
 const result=reportingTrade(trade)
 assert.equal(result.symbol,'CRUDE');assert.equal(result.original_symbol,'crude/usd')
 assert.equal(result.id,1);assert.equal(result.position_id,'unchanged');assert.equal(result.entry_price,100);assert.equal(result.size,2)
 assert.equal(trade.symbol,'crude/usd');assert.deepEqual(reportingTrade(result),result)
})

test('family P&L and win rate aggregate individual trades, with product drilldown',()=>{
 const trades=[{symbol:'CRUDE',pnl:10,currency:'USDC',direction:'Long'},{symbol:'WTI/USD',pnl:-2,currency:'USDT',direction:'Short'},{symbol:'USO',pnl:4,currency:'USD',direction:'Long'},{symbol:'BITI',pnl:3,currency:'USD',direction:'Long'},{symbol:'IBIT',pnl:-1,currency:'USD',direction:'Long'}]
 const families=symbolReport(trades)
 const oil=families.find(row=>row.symbol==='Crude oil')
 assert.equal(oil.count,3);assert.equal(oil.total_pnl,12);assert.equal(oil.win_rate,2/3)
 assert.equal(oil.products.length,2);assert.equal(oil.products.find(row=>row.symbol==='CRUDE').count,2)
 const btc=families.find(row=>row.symbol==='Bitcoin');assert.equal(btc.bullish,1);assert.equal(btc.bearish,1)
 assert.equal(symbolReport(trades,'product').find(row=>row.symbol==='CRUDE').count,2)
 assert.equal(families.reduce((sum,row)=>sum+row.count,0),trades.length)
 assert.equal(families.reduce((sum,row)=>sum+row.total_pnl,0),14)
 assert.ok(!('entry_price' in oil));assert.ok(!('size' in oil))
})

test('unknown currency amounts are not silently summed as dollars',()=>{
 const [group]=symbolReport([{symbol:'BTC/USD',pnl:1,currency:'BTC',direction:'Long'},{symbol:'IBIT',pnl:10,currency:'USD',direction:'Long'}])
 assert.equal(group.total_pnl,null);assert.equal(group.comparable,false)
})
