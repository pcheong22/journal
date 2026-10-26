import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),{transformSync}=require('next/dist/build/swc')
const original=require.extensions['.js']
require.extensions['.js']=(module,file)=>{if(file.includes('/journal/lib/'))module._compile(transformSync(readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'ecmascript'},target:'es2020'},module:{type:'commonjs'}}).code,file);else original(module,file)}
const {buildImportPlan}=require('../lib/importPlan.js'),{parseImportFile}=require('../lib/importFile.js'),{extractPrimeXBTMeta,parsePrimeXBT}=require('../lib/parsers/primexbt.js'),{parseExtended}=require('../lib/parsers/extended.js'),{priceCheck}=require('../lib/symbols.js')
const trade={id:7,position_id:'P',account_id:'A',broker:'TxFlow',symbol:'BTC',direction:'Long',size:1,pnl:10,entry_price:100,exit_price:110,entry_time:'2026-01-01T00:00:00+00:00',exit_time:'2026-01-02T00:00:00+00:00',currency:'USDC',notes:'Keep me'}
const snapshot={trades:[trade],tags:[],images:[],digest:'D'}
const parsed=t=>({broker:'TxFlow',accountId:'A',currency:'USDC',trades:[t],warnings:[]})
test('repeat preview preserves journal identity, notes and equivalent timestamp formats',()=>{const plan=buildImportPlan(parsed({...trade,entry_time:'2026-01-01T00:00:00.000Z',exit_time:'2026-01-02T00:00:00.000Z'}),snapshot);assert.equal(plan.counts.skipped,1);assert.equal(plan.counts.updated,0);assert.equal(plan.operations[0].kind,'coverage')})
test('incomplete exports cannot replace known complete source coverage',()=>{const plan=buildImportPlan(parsed({...trade,pnl:3,_source_ids:['a']}),snapshot,{7:['a','b']});assert.equal(plan.counts.skipped,1);assert.equal(plan.operations.length,0)})
test('ambiguous corrected rows block writes rather than create a second trade',()=>{const plan=buildImportPlan(parsed({...trade,position_id:'OTHER',pnl:99}),snapshot);assert.equal(plan.counts.blocked,1);assert.equal(plan.operations.length,0)})
test('updates contain source fields only and require review for market changes',()=>{const plan=buildImportPlan(parsed({...trade,pnl:20,notes:'overwrite'}),snapshot);assert.equal(plan.counts.updated,1);assert.equal(plan.needsReview,true);assert.equal('notes' in plan.operations[0].after,false)})
test('PrimeXBT filenames resolve the real account while retaining legacy match metadata',()=>{assert.equal(extractPrimeXBTMeta('L259832_USDC_orders.csv').accountId,'L259832');assert.equal(extractPrimeXBTMeta('2026-05-08_L259832_USDT_orders.csv').currency,'USDT');assert.equal(extractPrimeXBTMeta('L259832_USDC_orders.csv').legacyAccountId,'USDC');assert.equal(extractPrimeXBTMeta('2026-07-29_L259832_USDC_orders.csv').legacyAccountId,'USDC')})
test('PrimeXBT retains separate realised closes minutes apart and matches their own openings',()=>{
 const header=['Order ID','Symbol','Type','Side','Status','Amount','Filled','Order Price','Executed price','Fee (USDC)','Round Settled P/L (USDC)','ROI, %','Placed Time (UTC)','Closed Time (UTC)']
 const rows=[header,
  ['close-2','USTEC','MARKET','SELL','EXECUTED','69.13','69.13','','28953.4','0','917.7818','4.94','2026-05-19 18:36:40','2026-05-19 18:36:40'],
  ['open-2','USTEC','LIMIT','BUY','EXECUTED','69.13','69.13','28940.4','28940.1','0','','','2026-05-19 18:32:55','2026-05-19 18:32:59'],
  ['close-1','USTEC','MARKET','SELL','EXECUTED','69.09','69.09','','28957.4','0','-15.1307','-0.08','2026-05-19 18:27:21','2026-05-19 18:27:21'],
  ['open-1','USTEC','LIMIT','BUY','EXECUTED','69.09','69.09','28957.8','28957.6','0','','','2026-05-19 17:52:00','2026-05-19 17:52:01']]
 const trades=parsePrimeXBT(rows,'USDC','USDC')
 assert.deepEqual(trades.map(row=>row.position_id),['close-1','close-2'])
 assert.deepEqual(trades.map(row=>row.entry_price),[28957.6,28940.1])
 assert.deepEqual(trades.map(row=>row.pnl),[-15.13,917.78])
 assert.ok(trades.every(row=>row.notional_method==='price_x_size'&&!priceCheck(row)))
 const old={id:8,position_id:'close-1_g2',account_id:'USDC',broker:'PrimeXBT',symbol:'NASDAQ',direction:'Long',size:138.22,entry_price:29136.9857,exit_price:28955.3994,pnl:902.65,fee:0,entry_time:'2026-05-19T17:52:00.000Z',exit_time:'2026-05-19T18:36:40.000Z',notes:'Keep this review'}
 const plan=buildImportPlan({broker:'PrimeXBT',accountId:'USDC',currency:'USDC',trades,warnings:[]},{trades:[old],tags:[],images:[],digest:'D'})
 assert.deepEqual(plan.counts,{inserted:1,updated:1,removed:0,skipped:0,blocked:0})
 assert.equal(plan.operations.find(row=>row.kind==='update').before.notes,'Keep this review')
})
test('PrimeXBT keeps a realised close when its opening history is absent',()=>{
 const rows=[['Order ID','Symbol','Type','Side','Status','Amount','Filled','Order Price','Executed price','Fee (USDC)','Round Settled P/L (USDC)','ROI, %','Placed Time (UTC)','Closed Time (UTC)'],['close-only','USTEC','MARKET','SELL','EXECUTED','1','1','','101','1','5','','2026-05-19 18:36:40','2026-05-19 18:36:40']]
 const [trade]=parsePrimeXBT(rows,'USDC','USDC')
 assert.equal(trade.entry_time,null);assert.equal(trade.entry_price,null);assert.equal(trade.exit_price,101);assert.equal(trade.notional_usd,101);assert.equal(trade.duration_mins,null)
 const old={id:10,position_id:'close-only',account_id:'USDC',broker:'PrimeXBT',symbol:'NASDAQ',direction:'Long',size:1,entry_price:110,exit_price:101,notional_method:'backsolve',pnl:5,entry_time:'2026-05-19T17:00:00.000Z',exit_time:trade.exit_time,duration_mins:96.7,notes:'Keep this review'}
 const plan=buildImportPlan({broker:'PrimeXBT',accountId:'USDC',currency:'USDC',trades:[trade],warnings:[]},{trades:[old],tags:[],images:[],digest:'D'})
 const update=plan.operations.find(row=>row.kind==='update')
 assert.equal(update.before.notes,'Keep this review');assert.equal(update.after.entry_price,null);assert.equal(update.after.entry_time,null);assert.equal(update.after.duration_mins,null)
})
test('Extended retains separate realised rows, truthful missing durations and a safe legacy split',()=>{
 const header=['market','side','size','entry_price','realised_pnl','trade_pnl','funding_fees','trading_fees','exit_price','exit_type','closed_at']
 const rows=[header,
  ['BTC-USD','LONG','2','100','18','20','-1','-1','110','TRADE','2026-01-27T18:00:00.000Z'],
  ['BTC-USD','LONG','1','105','-7','-5','-1','-1','100','TRADE','2026-01-27T16:00:00.000Z']]
 const parsed=parseExtended(rows,'realised_pnl.csv','EXTENDED_DEFAULT'),replay=parseExtended([header,...rows.slice(1).reverse()],'realised_pnl.csv','EXTENDED_DEFAULT')
 assert.equal(parsed.trades.length,2)
 assert.deepEqual(replay.trades,parsed.trades)
 assert.ok(parsed.trades.every(row=>row.entry_time===null&&row.duration_mins===null&&row.notional_method==='price_x_size'))
 assert.equal(parsed.trades.filter(row=>row._legacy_position_id).length,1)
 const old={id:9,position_id:'EXT_BTC-USD_LONG_2026-01-27',account_id:'EXTENDED_DEFAULT',broker:'Extended',symbol:'BTC/USD',direction:'Long',size:3,entry_price:101.67,exit_price:106.67,pnl:11,fee:4,exit_time:'2026-01-27T18:00:00.000Z',notes:'Keep this review'}
 const plan=buildImportPlan({...parsed,warnings:[]},{trades:[old],tags:[],images:[],digest:'D'})
 assert.deepEqual(plan.counts,{inserted:1,updated:1,removed:0,skipped:0,blocked:0})
 const update=plan.operations.find(row=>row.kind==='update')
 assert.equal(update.before.notes,'Keep this review')
 assert.equal(update.after.entry_time,null)
 assert.equal(update.after.duration_mins,null)
})
test('original Hyperliquid and TxFlow exports retain every position and reconcile P&L',{skip:!existsSync(new URL('../../import-sources/trade_history_hl.csv',import.meta.url))},()=>{for(const [file,account,count] of [['trade_history_hl.csv','0xffbB07326634300D7ef131E2B5826Dcb49c0C8E0',10],['trade-history-all-D0F9.csv','0x2A8F7F1682B629b16f5309182DA8920dAF72D0F9',null],['trade-history-all-6466.csv','0x950793403DFaA533c7ef84E81272bf94f5b46466',null]]){const value=parseImportFile(readFileSync(new URL('../../import-sources/'+file,import.meta.url)),file,account,'Asia/Dubai');assert.ok(value.trades.length>0);assert.equal(value.audit.matched,true,JSON.stringify(value.audit));assert.ok(value.trades.every(t=>t._source_ids.length>0));if(value.broker==='TxFlow'){const replay=parseImportFile(readFileSync(new URL('../../import-sources/'+file,import.meta.url)),file,value.accountId,'Asia/Dubai');assert.deepEqual(replay.trades,value.trades)}}})
