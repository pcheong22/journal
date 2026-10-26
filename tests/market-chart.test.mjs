import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import vm from 'node:vm'
import React from 'react'
import Renderer,{act} from 'react-test-renderer'
const require=createRequire(import.meta.url),{transformSync}=require('next/dist/build/swc')
const compile=path=>transformSync(readFileSync(new URL(path,import.meta.url),'utf8'),{filename:'chart.jsx',jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}).code
const symbols={};vm.runInNewContext(compile('../lib/symbols.js'),{exports:symbols,require})
const model={};vm.runInNewContext(compile('../lib/marketChart.js'),{exports:model,URLSearchParams,require:path=>path==='./symbols'?symbols:require(path)})
const {chartReference,chartUrl,initialChartInterval}=model
const trade={id:1,symbol:'CRUDE/USD',original_symbol:'CLJ6',tv_symbol:'NYMEX:CL1!',broker:'Hyperliquid',entry_time:'2026-10-21T10:00:00Z',exit_time:'2026-10-21T11:00:00Z',duration_mins:60}
test('reference feeds repair stale aliases without changing contract or source identity',()=>{
 const view=chartReference(trade);assert.equal(view.symbol,'OANDA:WTICOUSD');assert.equal(view.savedSymbol,'NYMEX:CL1!');assert.match(view.label,/CFD/);assert.equal(trade.tv_symbol,'NYMEX:CL1!');assert.equal(trade.original_symbol,'CLJ6')
 assert.equal(chartReference({symbol:'WTI/USD'}).symbol,'OANDA:WTICOUSD')
 assert.equal(chartReference({symbol:'COPPER/USD'}).symbol,'OANDA:XCUUSD')
 assert.equal(chartReference({symbol:'HK-HSI'}).symbol,'OANDA:HK33HKD')
 for(const symbol of ['USO','IBIT','BITO','BITI'])assert.match(chartReference({symbol}).symbol,new RegExp(':'+symbol+'$'))
 assert.equal(chartReference({symbol:'ASTEROID/USD',tv_symbol:'ASTEROID'}).symbol,null)
})
test('chart URLs encode fixed destinations, respect theme, and disable unsynchronised symbol changes',()=>{
 const url=new URL(chartUrl('OANDA:WTICOUSD',true,'60'));assert.equal(url.hostname,'www.tradingview.com');assert.equal(url.searchParams.get('theme'),'dark');assert.equal(url.searchParams.get('symbol'),'OANDA:WTICOUSD');assert.equal(url.searchParams.get('allow_symbol_change'),'0');assert.equal(url.searchParams.get('timezone'),'Etc/UTC')
 assert.equal(chartUrl('javascript:alert(1)'),null);assert.equal(initialChartInterval(trade),'5');assert.equal(initialChartInterval({duration_mins:null}),'60')
})
let observer,theme=false,timer
const exported={};vm.runInNewContext(compile('../components/MarketChart.js'),{exports:exported,require:path=>path==='../lib/marketChart'?model:require(path),document:{body:{classList:{contains:()=>theme}}},MutationObserver:class{constructor(fn){observer=fn}observe(){}disconnect(){}},setTimeout:fn=>{timer=fn;return 1},clearTimeout(){}})
const Chart=exported.default,text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node?.children?.map(text).join('')||''
test('chart opens lazily, survives tab switches, and never treats iframe load as verified market data',async()=>{
 let view;await act(async()=>{view=Renderer.create(React.createElement(Chart,{trade,active:false}))});assert.equal(view.root.findAllByType('iframe').length,0)
 await act(async()=>view.update(React.createElement(Chart,{trade,active:true})));const frame=view.root.findByType('iframe')
 await act(async()=>frame.props.onLoad());assert.match(text(view.toJSON()),/frame opened/i);assert.doesNotMatch(text(view.toJSON()),/data ready/i)
 await act(async()=>view.update(React.createElement(Chart,{trade,active:false})));assert.equal(view.root.findByType('iframe'),frame)
 await act(async()=>view.update(React.createElement(Chart,{trade,active:true})));assert.equal(view.root.findByType('iframe'),frame)
 await act(async()=>{theme=true;observer()});assert.match(view.root.findByType('iframe').props.src,/theme=dark/)
 await act(async()=>view.root.findAllByType('button').find(b=>text(b)==='Chart not working?').props.onClick());assert.equal(view.root.findAllByType('iframe').length,0);assert.match(text(view.toJSON()),/Chart unavailable here/)
 await act(async()=>view.root.findAllByType('button').find(b=>text(b)==='Retry chart').props.onClick());assert.equal(view.root.findAllByType('iframe').length,1)
 await act(async()=>timer());assert.match(text(view.toJSON()),/taking longer/);view.unmount()
})
test('sample preview never contacts TradingView',async()=>{let view;await act(async()=>{view=Renderer.create(React.createElement(Chart,{trade,active:true,preview:true}))});assert.equal(view.root.findAllByType('iframe').length,0);assert.match(text(view.toJSON()),/disabled in this sample/);view.unmount()})
