import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),{transformSync}=require('next/dist/build/swc')
const original=require.extensions['.js']
require.extensions['.js']=(module,file)=>{if(file.includes('/journal/lib/'))module._compile(transformSync(readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'ecmascript'},target:'es2020'},module:{type:'commonjs'}}).code,file);else original(module,file)}
const {buildImportPlan}=require('../lib/importPlan.js'),{parseImportFile}=require('../lib/importFile.js'),{extractPrimeXBTMeta}=require('../lib/parsers/primexbt.js')
const trade={id:7,position_id:'P',account_id:'A',broker:'TxFlow',symbol:'BTC',direction:'Long',size:1,pnl:10,entry_price:100,exit_price:110,entry_time:'2026-01-01T00:00:00+00:00',exit_time:'2026-01-02T00:00:00+00:00',currency:'USDC',notes:'Keep me'}
const snapshot={trades:[trade],tags:[],images:[],digest:'D'}
const parsed=t=>({broker:'TxFlow',accountId:'A',currency:'USDC',trades:[t],warnings:[]})
test('repeat preview preserves journal identity, notes and equivalent timestamp formats',()=>{const plan=buildImportPlan(parsed({...trade,entry_time:'2026-01-01T00:00:00.000Z',exit_time:'2026-01-02T00:00:00.000Z'}),snapshot);assert.equal(plan.counts.skipped,1);assert.equal(plan.counts.updated,0);assert.equal(plan.operations[0].kind,'coverage')})
test('incomplete exports cannot replace known complete source coverage',()=>{const plan=buildImportPlan(parsed({...trade,pnl:3,_source_ids:['a']}),snapshot,{7:['a','b']});assert.equal(plan.counts.skipped,1);assert.equal(plan.operations.length,0)})
test('ambiguous corrected rows block writes rather than create a second trade',()=>{const plan=buildImportPlan(parsed({...trade,position_id:'OTHER',pnl:99}),snapshot);assert.equal(plan.counts.blocked,1);assert.equal(plan.operations.length,0)})
test('updates contain source fields only and require review for market changes',()=>{const plan=buildImportPlan(parsed({...trade,pnl:20,notes:'overwrite'}),snapshot);assert.equal(plan.counts.updated,1);assert.equal(plan.needsReview,true);assert.equal('notes' in plan.operations[0].after,false)})
test('PrimeXBT filenames resolve the real account while retaining legacy match metadata',()=>{assert.equal(extractPrimeXBTMeta('L259832_USDC_orders.csv').accountId,'L259832');assert.equal(extractPrimeXBTMeta('2026-05-08_L259832_USDT_orders.csv').currency,'USDT');assert.equal(extractPrimeXBTMeta('L259832_USDC_orders.csv').legacyAccountId,'USDC')})
test('original Hyperliquid and TxFlow exports retain every position and reconcile P&L',{skip:!existsSync(new URL('../../import-sources/trade_history_hl.csv',import.meta.url))},()=>{for(const [file,account,count] of [['trade_history_hl.csv','0xffbB07326634300D7ef131E2B5826Dcb49c0C8E0',10],['trade-history-all-D0F9.csv','0x2A8F7F1682B629b16f5309182DA8920dAF72D0F9',null],['trade-history-all-6466.csv','0x950793403DFaA533c7ef84E81272bf94f5b46466',null]]){const value=parseImportFile(readFileSync(new URL('../../import-sources/'+file,import.meta.url)),file,account,'Asia/Dubai');assert.ok(value.trades.length>0);assert.equal(value.audit.matched,true,JSON.stringify(value.audit));assert.ok(value.trades.every(t=>t._source_ids.length>0))}})
