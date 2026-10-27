import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import vm from 'node:vm'
import React from 'react'
import Renderer,{act} from 'react-test-renderer'
const require=createRequire(import.meta.url),{transformSync}=require('next/dist/build/swc')
const compile=(path,jsx=false)=>transformSync(readFileSync(new URL(path,import.meta.url),'utf8'),{filename:path,jsc:{parser:{syntax:'ecmascript',jsx},target:'es2022',transform:jsx?{react:{runtime:'automatic'}}:undefined},module:{type:'commonjs'}}).code
const load=(path,context,jsx=false)=>{const exports={};vm.runInNewContext(compile(path,jsx),{exports,URL,URLSearchParams,AbortSignal,Response,console,setTimeout,clearTimeout,setInterval,clearInterval,...context});return exports}
const symbols=load('../lib/symbols.js',{require})
const chart=load('../lib/marketChart.js',{require:path=>path==='./symbols'?symbols:require(path)})
const pivots=load('../lib/pivots.js',{require})
const history=load('../lib/marketHistory.js',{require:path=>path==='./symbols'?symbols:path==='./pivots'?pivots:require(path),fetch})
const replay=load('../components/HistoricalReplayChart.js',{require:path=>path==='react'?React:path==='react/jsx-runtime'?require(path):require(path)},true)
const trade={id:1,symbol:'CRUDE/USD',original_symbol:'CLJ6',tv_symbol:'NYMEX:CL1!',broker:'Hyperliquid',direction:'Long',entry_time:'2026-10-21T10:00:00Z',exit_time:'2026-10-21T11:00:00Z',entry_price:70,exit_price:71,duration_mins:60}

test('reference feeds repair stale aliases without changing contract or source identity',()=>{
 const view=chart.chartReference(trade);assert.equal(view.symbol,'OANDA:WTICOUSD');assert.equal(view.savedSymbol,'NYMEX:CL1!');assert.match(view.label,/CFD/);assert.equal(trade.tv_symbol,'NYMEX:CL1!')
 assert.equal(chart.chartReference({symbol:'WTI/USD'}).symbol,'OANDA:WTICOUSD');assert.equal(chart.chartReference({symbol:'COPPER/USD'}).symbol,'OANDA:XCUUSD')
 for(const symbol of ['USO','IBIT','BITO','BITI'])assert.match(chart.chartReference({symbol}).symbol,new RegExp(':'+symbol+'$'))
})

test('historical profiles cover crypto, futures, metals, FX and ETFs without changing trade identity',()=>{
 assert.deepEqual([...history.HISTORY_INTERVALS],['1m','5m','15m','30m','1h','2h','4h','8h','1d','1w'])
 assert.equal(JSON.stringify(history.historyProfile({symbol:'BTC/USD'}).providers.map(p=>p.kind)),JSON.stringify(['hyperliquid','yahoo']))
 assert.equal(history.historyProfile({symbol:'CRUDE/USD'}).providers[0].symbol,'CL=F')
 assert.equal(history.historyProfile({symbol:'XAG/USD'}).providers[0].symbol,'SI=F')
 assert.equal(history.historyProfile({symbol:'EUR/USD'}).providers[0].symbol,'EURUSD=X')
 assert.equal(history.historyProfile({symbol:'IBIT'}).providers[0].symbol,'IBIT')
 assert.equal(history.historyProfile({symbol:'ASTEROID/USD'}).providers.length,0)
 assert.equal(trade.symbol,'CRUDE/USD')
})

test('chart interval widens for old trades and windows surround the entire position',()=>{
 const recent={...trade,entry_time:'2026-10-25T10:00:00Z',exit_time:'2026-10-25T11:00:00Z'}
 assert.equal(history.defaultHistoryInterval(recent,Date.parse('2026-10-26T00:00:00Z')),'5m')
 assert.equal(history.defaultHistoryInterval({...trade,symbol:'BTC/USD'},Date.parse('2028-10-26T00:00:00Z')),'4h')
 assert.equal(history.defaultHistoryInterval(trade,Date.parse('2028-10-26T00:00:00Z')),'1d')
 const window=history.historyWindow(trade,'5m');assert.ok(window.start<Date.parse(trade.entry_time));assert.ok(window.end>Date.parse(trade.exit_time))
})

test('Hyperliquid candles are normalised and invalid provider rows are discarded',async()=>{
 const mock=async(url,init)=>{assert.equal(url,'https://api.hyperliquid.xyz/info');const body=JSON.parse(init.body);assert.equal(body.type,'candleSnapshot');assert.equal(body.req.coin,'BTC');return new Response(JSON.stringify([{t:1000,o:'10',h:'12',l:'9',c:'11',v:'7'},{t:2000,o:null,h:'12',l:'9',c:'11'}]))}
 const candles=await history.fetchHyperliquidHistory('BTC','5m',{start:0,end:10000},mock)
 assert.equal(JSON.stringify(candles),JSON.stringify([{time:1,open:10,high:12,low:9,close:11,volume:7}]))
})

test('Hyperliquid receives native wide replay intervals',async()=>{
 const requested=[];const mock=async(url,init)=>{requested.push(JSON.parse(init.body).req.interval);return new Response(JSON.stringify([{t:1000,o:'10',h:'12',l:'9',c:'11',v:'7'}]))}
 for(const interval of ['2h','4h','8h','1w'])await history.fetchHyperliquidHistory('BTC',interval,{start:0,end:10000},mock)
 assert.deepEqual(requested,['2h','4h','8h','1w'])
})

test('Yahoo-backed wide replay bars are aggregated from hourly candles',async()=>{
 const hour=3600,requested=[]
 const mock=async url=>{requested.push(new URL(url).searchParams.get('interval'));return new Response(JSON.stringify({chart:{result:[{timestamp:[0,hour,2*hour,3*hour,4*hour],indicators:{quote:[{open:[10,11,12,13,14],high:[12,13,14,15,16],low:[8,9,10,11,12],close:[11,12,13,14,15],volume:[1,2,3,4,5]}]}}],error:null}}))}
 const candles=await history.fetchYahooHistory('CL=F','4h',{start:0,end:5*hour*1000},mock)
 assert.equal(requested[0],'60m');assert.deepEqual(JSON.parse(JSON.stringify(candles)),[{time:0,open:10,high:15,low:8,close:14,volume:10},{time:4*hour,open:14,high:16,low:12,close:15,volume:5}])
 await history.fetchYahooHistory('CL=F','1w',{start:0,end:5*hour*1000},mock);assert.equal(requested[1],'1wk')
})

test('pivot references request daily history from the start of the prior UTC year',async()=>{
 const calls=[];const mock=async(url,init)=>{calls.push(JSON.parse(init.body));return new Response(JSON.stringify([{t:Date.parse('2025-01-01T00:00:00Z'),o:'10',h:'12',l:'9',c:'11'},{t:Date.parse('2026-01-01T00:00:00Z'),o:'11',h:'13',l:'10',c:'12'}]))}
 const result=await history.fetchPivotReference({...trade,symbol:'BTC/USD',entry_time:'2026-10-21T10:00:00Z'},mock)
 assert.equal(calls[0].req.interval,'1d');assert.equal(new Date(calls[0].req.startTime).toISOString(),'2025-01-01T00:00:00.000Z');assert.equal(result.source.kind,'hyperliquid')
})

test('execution markers retain imported fills and fall back to saved entry and exit',()=>{
 const record={fills:[{time:'2026-10-21T10:00:00Z',price:'70.1',quantity:'2',side:'B'},{time:'2026-10-21T11:00:00Z',price:'71.2',quantity:'2',side:'Sell'}]}
 assert.equal(JSON.stringify(history.executionMarkers(trade,record).map(m=>[m.side,m.price,m.source])),JSON.stringify([['Buy',70.1,'fill'],['Sell',71.2,'fill']]))
 assert.equal(JSON.stringify(history.executionMarkers(trade,null).map(m=>[m.side,m.price,m.source])),JSON.stringify([['Buy',70,'average entry'],['Sell',71,'average exit']]))
})

test('markers align to candle timestamps and group same-candle fills',()=>{
 const candles=[{time:100},{time:200},{time:300}],markers=[{time:110000,side:'Buy',price:10},{time:120000,side:'Buy',price:12},{time:250000,side:'Sell',price:13}]
 const result=replay.chartMarkers(candles,markers);assert.equal(result.length,2);assert.equal(result[0].time,100);assert.match(result[0].text,/B×2 11/);assert.equal(result[1].time,200)
})

test('market chart loads lazily and preview history never calls the private API',async()=>{
 let calls=0,observer
 const request={journalFetch:async()=>{calls++;throw new Error('not expected')}}
 const exported=load('../components/MarketChart.js',{require:path=>path==='react'?React:path==='react/jsx-runtime'?require(path):path==='next/dynamic'?(()=>()=>null):path==='../lib/marketChart'?chart:path==='../lib/marketHistory'?history:path==='../lib/request'?request:require(path),document:{body:{classList:{contains:()=>false}}},MutationObserver:class{constructor(fn){observer=fn}observe(){}disconnect(){}}},true)
 const Component=exported.default;let view
 await act(async()=>{view=Renderer.create(React.createElement(Component,{trade,active:false,preview:true}))});assert.equal(calls,0)
 await act(async()=>view.update(React.createElement(Component,{trade,active:true,preview:true})));const rendered=JSON.stringify(view.toJSON());assert.equal(calls,0);assert.match(rendered,/Representative chart data/);assert.match(rendered,/2 hours/);assert.match(rendered,/1 week/);observer();view.unmount()
})

test('market history API selects only stored trade columns before loading crude candles',async()=>{
 let selected='',status,body,cache
 const query={select(columns){selected=columns;return query},eq(){return query},async single(){return {data:{...trade,id:9868,symbol:'WTI/USD',broker:'Extended'},error:null}}}
 const api=load('../pages/api/market-history.js',{process:{env:{}},require:path=>{
  if(path==='@supabase/supabase-js')return {createClient:()=>({from:()=>query})}
  if(path==='../../lib/serverAuth')return {requireOwner:async()=>true}
  if(path==='../../lib/executionStore')return {readExecutionRecord:async()=>null}
  if(path==='../../lib/marketHistory')return {HISTORY_INTERVALS:['1h'],defaultHistoryInterval:()=> '1h',fetchMarketHistory:async()=>({candles:[{time:1},{time:2}],interval:'1h',source:{kind:'yahoo',symbol:'CL=F'}}),fetchPivotReference:async()=>null,executionMarkers:()=>[]}
  if(path==='../../lib/pivots')return {pivotContext:()=>null}
  return require(path)
 }})
 const res={setHeader(name,value){if(name==='Cache-Control')cache=value},status(value){status=value;return res},json(value){body=value;return res}}
 await api.default({method:'GET',query:{tradeId:'9868'}},res)
 assert.doesNotMatch(selected,/original_symbol/);assert.equal(status,200);assert.equal(body.history.source.symbol,'CL=F');assert.match(cache,/max-age=300/)
})

test('market history errors are never cached',async()=>{
 let status,cache
 const query={select(){return query},eq(){return query},async single(){return {data:null,error:{message:'missing column'}}}}
 const api=load('../pages/api/market-history.js',{process:{env:{}},require:path=>{
  if(path==='@supabase/supabase-js')return {createClient:()=>({from:()=>query})}
  if(path==='../../lib/serverAuth')return {requireOwner:async()=>true}
  if(path==='../../lib/executionStore')return {readExecutionRecord:async()=>null}
  if(path==='../../lib/marketHistory')return {HISTORY_INTERVALS:['1h']}
  if(path==='../../lib/pivots')return {}
  return require(path)
 }})
 const res={setHeader(name,value){if(name==='Cache-Control')cache=value},status(value){status=value;return res},json(){return res}}
 await api.default({method:'GET',query:{tradeId:'9868'}},res)
 assert.equal(status,502);assert.match(cache,/no-store/)
})
