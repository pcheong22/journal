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
 await act(async()=>view.update(React.createElement(Component,{trade,active:true,preview:true})));assert.equal(calls,0);assert.match(JSON.stringify(view.toJSON()),/Representative chart data/);observer();view.unmount()
})
