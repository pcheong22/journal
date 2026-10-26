import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import vm from 'node:vm'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
const require=createRequire(import.meta.url),{transformSync}=require('next/dist/build/swc')
const compile=path=>transformSync(readFileSync(new URL(path,import.meta.url),'utf8'),{filename:'test.jsx',jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}).code
const exports={};vm.runInNewContext(compile('../components/JournalLoading.js'),{exports,require})
test('initial loading has an announced state and a recoverable error state',()=>{
 const loading=renderToStaticMarkup(React.createElement(exports.default,{}))
 assert.match(loading,/role="status"/);assert.match(loading,/aria-busy="true"/);assert.match(loading,/Opening your journal/)
 const failed=renderToStaticMarkup(React.createElement(exports.default,{error:'Please retry.',onRetry(){}}))
 assert.match(failed,/role="alert"/);assert.match(failed,/Retry loading/);assert.doesNotMatch(failed,/loading-layout/)
})
test('metadata loads concurrently and execution counts are retained',async()=>{
 const requested=new Set(),record={id:7,account_id:'A',broker:'TxFlow',trade_tag_mappings:[{tag_id:4}]}
 const db={from(table){const chain={select(){return chain},order(){if(table!=='trades')requested.add(table);return chain},range:async()=>({data:[record]}),then(resolve,reject){return Promise.resolve({data:[]}).then(resolve,reject)}};return chain}}
 const api={};vm.runInNewContext(compile('../pages/api/trades.js'),{exports:api,process:{env:{}},console,require:path=>{
  if(path==='../../lib/serverAuth')return {requireOwner:async()=>true}
  if(path==='@supabase/supabase-js')return {createClient:()=>db}
  if(path==='../../lib/symbols')return {reportingTrade:t=>t}
  if(path==='../../lib/executionStore')return {executionIndex:async()=>{await new Promise(resolve=>setImmediate(resolve));assert.ok(requested.has('accounts'));assert.ok(requested.has('trade_tags'));return {7:{count:28}}}}
  return require(path)
 }})
 let status,body;const res={status(s){status=s;return res},json(b){body=b;return res}}
 await api.default({method:'GET',query:{}},res)
 assert.equal(status,200);assert.equal(body.trades[0].execution_count,28);assert.deepEqual([...body.trades[0].tag_ids],[4])
})
