import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const executionSource = await readFile(new URL('../lib/executionUtils.js', import.meta.url), 'utf8')
const utilsURL = url(executionSource)
const { executionView, allocateExecution, combineExecutions } = await import(utilsURL)
const storeSource = (await readFile(new URL('../lib/executionStore.js', import.meta.url), 'utf8')).replace("'./executionUtils'", JSON.stringify(utilsURL))
const { saveExecutionRecords, executionIndex, readExecutionRecord, ensureExecutionStore } = await import(url(storeSource))
const fill = (action, quantity, price, time, key) => ({ action, quantity, price, time:`2026-10-20T${time}.000Z`, side:action==='open'?'Buy':'Sell', fee:1, reported_pnl:action==='close'?10:0, source_key:key, sequence:0 })
const fills = [fill('open',10,100,'10:00:00','a'),fill('close',5,110,'11:00:00','b'),fill('open',5,120,'12:00:00','c'),fill('close',10,120,'13:00:00','d')]

test('running cost follows the remaining position after a reduction and add', () => {
 const view=executionView(fills)
 assert.equal(view.rows[1].remaining,5)
 assert.equal(view.rows[1].average_cost,100)
 assert.equal(view.rows[2].average_cost,110)
 assert.equal(view.remaining,0)
 assert.equal(view.average_cost,null)
 assert.ok(Math.abs(view.realised_average_cost-106.6666666667)<1e-8)
 assert.deepEqual(view.batches.map(b=>b.label),['Entry','Reduce','Add','Exit'])
})

test('same-second fills become expandable timestamp batches without fabricated order IDs', () => {
 const view=executionView([fill('open',1,100,'10:00:00','a'),fill('open',2,110,'10:00:00','b'),fill('close',3,120,'11:00:00','c')])
 assert.equal(view.batches.length,2)
 assert.equal(view.batches[0].fills.length,2)
 assert.equal(view.batches[0].quantity,3)
 assert.ok(Math.abs(view.batches[0].price-106.6666666667)<1e-8)
 assert.equal(view.batches[0].grouping,'timestamp')
 assert.equal(view.batches[0].order_id,null)
})

test('missing opening history is marked incomplete rather than inventing a cost basis', () => {
 const view=executionView([fill('close',10,120,'11:00:00','a')])
 assert.equal(view.complete,false)
 assert.equal(view.realised_average_cost,null)
})

test('proportional allocations recombine, but distinct identical executions remain distinct', () => {
 const source=fill('close',10,100,'10:00:00','a')
 const combined=combineExecutions([allocateExecution(source,.3),allocateExecution(source,.7),{...source,source_key:'b'}])
 assert.equal(combined.length,2)
 assert.equal(combined[0].quantity,10)
 assert.equal(combined[0].fee,1)
})

function storageMock() {
 const files=new Map(); let publicBucket=false, createOptions=null
 const trade={id:7,account_id:'wallet-A',position_id:'position-A',broker:'TxFlow',exit_time:fills[3].time,entry_time:fills[0].time,pnl:16,fee:4}
 const bucket={
  async list(prefix,{offset=0,limit=1000}={}) { const data=[...files.entries()].filter(([key])=>key.startsWith(prefix+'/')).map(([key,value])=>({name:key.slice(prefix.length+1),created_at:value.created_at})); return {data:data.slice(offset,offset+limit),error:null} },
  async upload(path,body) {if(files.has(path))return {error:{message:'The resource already exists'}};files.set(path,{body,created_at:new Date().toISOString()});return {error:null}},
  async download(path) {return {data:{text:async()=>files.get(path).body},error:null}},
 }
 return {files,trade,get options(){return createOptions},get publicBucket(){return publicBucket},
  storage:{async getBucket(){return {data:null,error:{statusCode:404,message:'Bucket not found'}}},async createBucket(name,options){createOptions=options;publicBucket=options.public;return {error:null}},from(){return bucket}},
  from(){const q={select(){return q},eq(){return q},async single(){return {data:trade,error:null}}};return q},
 }
}

test('private snapshots backfill a journal row and identical reuploads do not duplicate records', async () => {
 const db=storageMock()
 const parsed={accountId:db.trade.account_id,executions:[{position_id:db.trade.position_id,fills,pnl_basis:'Exported net fees'}]}
 const original=structuredClone(db.trade)
 assert.equal(await saveExecutionRecords(db,parsed,'history.csv','Asia/Dubai'),4)
 assert.equal(db.options.public,false)
 assert.equal(await saveExecutionRecords(db,parsed,'history.csv','Asia/Dubai'),4)
 assert.equal(db.files.size,1)
 assert.deepEqual(db.trade,original)
 const index=await executionIndex(db,'wallet-A');assert.equal(index[7].count,4)
 assert.deepEqual(await executionIndex(db,'wallet-B'),{})
 const record=await readExecutionRecord(db,db.trade)
 assert.equal(record.fills.length,4)
 assert.equal(record.source.timezone,'Asia/Dubai')
})

test('older snapshots cannot hide a more complete execution record', async () => {
 const db=storageMock()
 const parsed={accountId:db.trade.account_id,executions:[{position_id:db.trade.position_id,fills,pnl_basis:'fees'}]}
 await saveExecutionRecords(db,parsed,'full.csv','Asia/Dubai')
 db.trade.exit_time=fills[1].time
 await saveExecutionRecords(db,{...parsed,executions:[{...parsed.executions[0],fills:fills.slice(0,2)}]},'old.csv','Asia/Dubai')
 assert.equal((await executionIndex(db,'wallet-A'))[7].count,4)
})

test('a snapshot with the wrong trade identity is rejected', async () => {
 const db=storageMock()
 await saveExecutionRecords(db,{accountId:db.trade.account_id,executions:[{position_id:db.trade.position_id,fills}]},'history.csv','UTC')
 db.trade.position_id='another-position'
 await assert.rejects(readExecutionRecord(db,db.trade),/does not match/)
})
