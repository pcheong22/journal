import { canonicalSymbol } from './symbols'
import { pivotReferenceWindow } from './pivots'

export const HISTORY_INTERVALS = ['1m','5m','15m','30m','1h','4h','1d']
const INTERVAL_MS = { '1m':60000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000 }
const HL_INTERVAL = Object.fromEntries(HISTORY_INTERVALS.map(value=>[value,value]))
const YAHOO_INTERVAL = { '1m':'1m','5m':'5m','15m':'15m','30m':'30m','1h':'60m','4h':'60m','1d':'1d' }
const CRYPTO = new Set(['BTC','ETH','SOL','HYPE','XRP','XLM','ADA','AVAX','LTC','BNB','DOGE','LINK','ARB','OP'])
const YAHOO_SYMBOLS = {
  NASDAQ:'NQ=F',SP500:'ES=F',DOWJ:'YM=F',CRUDE:'CL=F','NAT.GAS':'NG=F','COPPER/USD':'HG=F',
  'XAU/USD':'GC=F','XAG/USD':'SI=F','HK-HSI':'^HSI',DAX:'^GDAXI',NIKKEI:'^N225',EUR50:'^STOXX50E',
  USO:'USO',IBIT:'IBIT',BITO:'BITO',BITI:'BITI',
  'EUR/USD':'EURUSD=X','USD/JPY':'JPY=X','GBP/USD':'GBPUSD=X','AUD/USD':'AUDUSD=X',
  'USD/CAD':'CAD=X','EUR/JPY':'EURJPY=X','CAD/JPY':'CADJPY=X',
}

const validTime = value => { const time=Date.parse(value); return Number.isFinite(time)?time:null }
export const intervalMillis = interval => INTERVAL_MS[interval] || INTERVAL_MS['1h']

export function defaultHistoryInterval(trade, now=Date.now()) {
  const opened=validTime(trade.entry_time),closed=validTime(trade.exit_time)
  const duration=trade.duration_mins==null?null:Number(trade.duration_mins)
  let interval=duration==null||!Number.isFinite(duration)?'1h':duration<=180?'5m':duration<=1440?'15m':duration<=10080?'1h':'4h'
  // Hyperliquid exposes only the latest 5,000 candles, so older trades need a
  // wider interval even when the position itself was brief.
  const age=Math.max(0,now-(closed||opened||now))
  for(const candidate of ['5m','15m','30m','1h','4h','1d'])if(age<=intervalMillis(candidate)*4800){
    if(intervalMillis(candidate)>intervalMillis(interval))interval=candidate
    break
  }
  const market=canonicalSymbol(trade.symbol),coin=market.endsWith('/USD')?market.slice(0,-4):null
  if(!CRYPTO.has(coin)&&age>58*86400000&&intervalMillis(interval)<intervalMillis('1h'))interval='1h'
  if(!CRYPTO.has(coin)&&age>720*86400000)interval='1d'
  return interval
}

export function historyWindow(trade, interval) {
  const opened=validTime(trade.entry_time),closed=validTime(trade.exit_time)
  if(opened==null&&closed==null)throw new Error('This trade has no usable historical timestamps.')
  const first=Math.min(opened??closed,closed??opened),last=Math.max(opened??closed,closed??opened)
  const span=Math.max(last-first,intervalMillis(interval)*12)
  const pad=Math.max(span*.65,intervalMillis(interval)*35)
  return {start:Math.max(0,Math.floor(first-pad)),end:Math.ceil(last+pad)}
}

export function historyProfile(trade) {
  const market=canonicalSymbol(trade.symbol),coin=market.endsWith('/USD')?market.slice(0,-4):null
  if(coin&&CRYPTO.has(coin))return {market,providers:[{kind:'hyperliquid',symbol:coin,label:`Hyperliquid ${coin} perpetual`},{kind:'yahoo',symbol:`${coin}-USD`,label:`Yahoo Finance ${coin}-USD reference`}]}
  const yahoo=YAHOO_SYMBOLS[market]
  return {market,providers:yahoo?[{kind:'yahoo',symbol:yahoo,label:`Yahoo Finance ${yahoo} reference`}]:[]}
}

const finite = value => { if(value==null||value==='')return null;const number=Number(value); return Number.isFinite(number)?number:null }
const validCandle = candle => candle && Number.isFinite(candle.time) && [candle.open,candle.high,candle.low,candle.close].every(Number.isFinite) && candle.low<=candle.high

async function checkedJSON(response, name) {
  if(!response.ok)throw new Error(`${name} returned ${response.status}.`)
  const text=await response.text()
  if(text.length>5_000_000)throw new Error(`${name} returned too much data.`)
  try{return JSON.parse(text)}catch{throw new Error(`${name} returned invalid data.`)}
}

export async function fetchHyperliquidHistory(symbol, interval, window, fetcher=fetch) {
  const response=await fetcher('https://api.hyperliquid.xyz/info',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'candleSnapshot',req:{coin:symbol,interval:HL_INTERVAL[interval],startTime:window.start,endTime:window.end}}),signal:AbortSignal.timeout(12000)})
  const rows=await checkedJSON(response,'Hyperliquid')
  if(!Array.isArray(rows))throw new Error('Hyperliquid returned an unexpected candle response.')
  return rows.map(row=>({time:Math.floor(Number(row.t)/1000),open:finite(row.o),high:finite(row.h),low:finite(row.l),close:finite(row.c),volume:finite(row.v)})).filter(validCandle)
}

export async function fetchYahooHistory(symbol, interval, window, fetcher=fetch) {
  const url=new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`)
  url.searchParams.set('period1',String(Math.floor(window.start/1000)))
  url.searchParams.set('period2',String(Math.ceil(window.end/1000)))
  url.searchParams.set('interval',YAHOO_INTERVAL[interval])
  url.searchParams.set('events','history')
  const response=await fetcher(url,{headers:{'user-agent':'Mozilla/5.0 (compatible; private-trading-journal/1.0)','accept':'application/json'},signal:AbortSignal.timeout(12000)})
  const body=await checkedJSON(response,'Reference market feed'),result=body?.chart?.result?.[0]
  if(body?.chart?.error)throw new Error(body.chart.error.description||'Reference market feed rejected this request.')
  const timestamps=result?.timestamp,quote=result?.indicators?.quote?.[0]
  if(!Array.isArray(timestamps)||!quote)throw new Error('Reference market feed returned no candles.')
  return timestamps.map((time,index)=>({time:Number(time),open:finite(quote.open?.[index]),high:finite(quote.high?.[index]),low:finite(quote.low?.[index]),close:finite(quote.close?.[index]),volume:finite(quote.volume?.[index])})).filter(validCandle)
}

export async function fetchMarketHistory(trade, requestedInterval, fetcher=fetch) {
  const interval=HISTORY_INTERVALS.includes(requestedInterval)?requestedInterval:defaultHistoryInterval(trade)
  const window=historyWindow(trade,interval),profile=historyProfile(trade)
  if(!profile.providers.length)throw new Error('No historical reference feed is mapped for this instrument yet.')
  const failures=[]
  for(const provider of profile.providers)try{
    const candles=provider.kind==='hyperliquid'
      ? await fetchHyperliquidHistory(provider.symbol,interval,window,fetcher)
      : await fetchYahooHistory(provider.symbol,interval,window,fetcher)
    if(candles.length<2)throw new Error('No candles were available around this trade.')
    return {candles,interval,window,source:provider}
  }catch(error){failures.push(`${provider.label}: ${error.message}`)}
  throw new Error(failures.join(' ')||'Historical candles are unavailable for this trade.')
}

export async function fetchPivotReference(trade,fetcher=fetch){
  const interval='1d',window=pivotReferenceWindow(trade),profile=historyProfile(trade)
  if(!profile.providers.length)throw new Error('No historical reference feed is mapped for this instrument yet.')
  const failures=[]
  for(const provider of profile.providers)try{
    const candles=provider.kind==='hyperliquid'
      ? await fetchHyperliquidHistory(provider.symbol,interval,window,fetcher)
      : await fetchYahooHistory(provider.symbol,interval,window,fetcher)
    if(candles.length<2)throw new Error('Not enough daily candles were available for pivot calculations.')
    return {candles,window,source:provider}
  }catch(error){failures.push(`${provider.label}: ${error.message}`)}
  throw new Error(failures.join(' ')||'Daily pivot reference data is unavailable for this trade.')
}

const buySide = value => /^(b|buy)$/i.test(String(value||''))
export function executionMarkers(trade, record) {
  const fills=Array.isArray(record?.fills)?record.fills:[]
  const markers=fills.map(fill=>({time:validTime(fill.time),price:finite(fill.price),quantity:finite(fill.quantity),side:buySide(fill.side)?'Buy':'Sell',source:'fill'})).filter(marker=>marker.time!=null&&marker.price!=null)
  if(markers.length)return markers.sort((a,b)=>a.time-b.time).slice(0,500)
  const opened=validTime(trade.entry_time),closed=validTime(trade.exit_time),long=trade.direction==='Long'
  return [
    opened!=null&&finite(trade.entry_price)!=null?{time:opened,price:Number(trade.entry_price),side:long?'Buy':'Sell',source:'average entry'}:null,
    closed!=null&&finite(trade.exit_price)!=null?{time:closed,price:Number(trade.exit_price),side:long?'Sell':'Buy',source:'average exit'}:null,
  ].filter(Boolean)
}
