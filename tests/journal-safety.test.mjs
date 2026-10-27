import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import React from 'react'
import Renderer, { act } from 'react-test-renderer'
const require=createRequire(import.meta.url)
const { transformSync }=require('next/dist/build/swc')
const pure=async path=>import('data:text/javascript;base64,'+Buffer.from(readFileSync(new URL(path,import.meta.url),'utf8')).toString('base64'))
const presentation=await pure('../lib/presentation.js')
const draft=await pure('../lib/noteDraft.js')
const notes=await pure('../lib/journalNotes.js'),backup=await pure('../lib/backupFormat.js'),request=await pure('../lib/request.js')
const code=transformSync(readFileSync(new URL('../components/TradeModal.js',import.meta.url),'utf8'),{filename:'TradeModal.js',jsc:{parser:{syntax:'ecmascript',jsx:true},target:'es2020',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}).code
const exports={}
vm.runInNewContext(code,{exports,console,document:{addEventListener(){},removeEventListener(){}},require:path=>{
  if(path==='react')return React
  if(path==='react/jsx-runtime')return require(path)
  if(path.endsWith('/presentation'))return presentation
  if(path.endsWith('/noteDraft'))return draft
  if(path.endsWith('/journalNotes'))return notes
  if(path.endsWith('/request'))return request
  if(path.endsWith('/tradeUtils'))return {simulatePnLPath:()=>null}
  if(path==='./Charts')return {PnlPathChart:()=>null}
  return ()=>null
}})
const TradeModal=exports.default
const trade={id:1,account_id:'A',position_id:'P',symbol:'BTC',direction:'Long',pnl:10,entry_price:100,exit_price:110,stop_loss:90,size:1,currency:'USD',duration_mins:60,tag_ids:[7],journal_revision:3,notes:'Original'}
const tags=[{id:7,name:'Patient',category:'Psychology',color:'#123456'},{id:9,name:'Reviewed',category:'Journal',color:'#059669'}]
const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node?.children?node.children.map(text).join(''):''
const button=(root,term)=>root.findAllByType('button').find(node=>text(node).toLowerCase().includes(term.toLowerCase()))

test('notes patch distinguishes untouched tags, clear tags and invalid stops',()=>{
 assert.equal(notes.noteRequest({tradeId:1,expectedRevision:0,notes:'x'}).p_tag_ids,null)
 assert.deepEqual(notes.noteRequest({tradeId:1,expectedRevision:0,tagIds:[]}).p_tag_ids,[])
 assert.deepEqual(notes.noteRequest({tradeId:1,expectedRevision:0,tagIds:[7,7]}).p_tag_ids,[7])
 const combined=notes.noteRequest({tradeId:1,expectedRevision:0,note_lessons:'Wait for confirmation.',tagIds:[7,9]})
 assert.equal(combined.p_patch.note_lessons,'Wait for confirmation.');assert.deepEqual(combined.p_tag_ids,[7,9])
 for(const bad of [0,-1,Infinity,'10'])assert.throws(()=>notes.noteRequest({tradeId:1,expectedRevision:0,stop_loss:bad}))
 assert.throws(()=>notes.noteRequest({tradeId:1,notes:'x'}),/Reload/)
 assert.equal(notes.noteRequest({tradeId:1,expectedRevision:0,stop_loss:null}).p_patch.stop_loss,null)
})
test('R follows the current stop, including losses and removal',()=>{
 assert.equal(notes.riskMultiple(trade,90),1)
 assert.equal(notes.riskMultiple(trade,95),2)
 assert.equal(notes.riskMultiple({...trade,exit_price:90},95),-2)
 assert.equal(notes.riskMultiple({...trade,direction:'Short',exit_price:90},110),1)
 for(const stop of [null,'',0,100,101])assert.equal(notes.riskMultiple(trade,stop),null)
 assert.equal(notes.riskMultiple({...trade,entry_price:null},90),null)
})
test('opening a tagged trade and saving notes preserves tags; clearing tags is explicit',async()=>{
 const previous=global.fetch;let payloads=[],saved
 global.fetch=async(url,init)=>{const body=JSON.parse(init.body);payloads.push(body);return new Response(JSON.stringify({success:true,trade:{...trade,journal_revision:4,tag_ids:body.tagIds || [7]}}))}
 let view
 try{
  await act(async()=>{view=Renderer.create(React.createElement(TradeModal,{trade,trades:[trade],tags,onClose(){},onNavigate(){},onSaved:t=>{saved=t}}))})
  await act(async()=>button(view.root,'Review').props.onClick())
  const field=view.root.findAllByType('textarea').find(node=>node.props.value==='Original')
  await act(async()=>field.props.onChange({target:{value:'Updated note'}}))
  await act(async()=>button(view.root,'Save Notes').props.onClick())
  assert.equal(payloads[0].notes,'Updated note');assert.equal('tagIds' in payloads[0],false);assert.equal(saved.tag_ids[0],7)
  await act(async()=>button(view.root,'Tags').props.onClick())
  await act(async()=>button(view.root,'Patient').props.onClick())
  await act(async()=>button(view.root,'Save Tags').props.onClick())
  assert.deepEqual(payloads[1].tagIds,[]);assert.equal('notes' in payloads[1],false)
 }finally{view?.unmount();global.fetch=previous}
})
test('failed notes saves retain the draft and never show Saved',async()=>{
 const previous=global.fetch;let saved=false,view
 global.fetch=async()=>new Response(JSON.stringify({error:'Database unavailable; retry'}),{status:503})
 try{
  await act(async()=>{view=Renderer.create(React.createElement(TradeModal,{trade,trades:[trade],tags,onClose(){},onNavigate(){},onSaved:()=>{saved=true}}))})
  await act(async()=>button(view.root,'Review').props.onClick())
  const field=view.root.findAllByType('textarea').find(node=>node.props.value==='Original')
  await act(async()=>field.props.onChange({target:{value:'Do not lose me'}}))
  await act(async()=>button(view.root,'Save Notes').props.onClick())
  assert.equal(saved,false)
  assert.ok(view.root.findAllByType('textarea').some(node=>node.props.value==='Do not lose me'))
  assert.ok(view.root.findAll(node=>node.props.role==='alert').some(node=>text(node).includes('Database unavailable')))
  assert.equal(button(view.root,'Saved!'),undefined)
 }finally{view?.unmount();global.fetch=previous}
})
test('full backup format rejects project mismatches, omitted tables and path escapes',()=>{
 const doc={format:'tradeintel-full-backup',version:backup.BACKUP_VERSION,project:'project',snapshot:{schema:'s',digest:'d',tables:Object.fromEntries(backup.BACKUP_TABLES.map(t=>[t,[]]))},files:[],checksum:'a'.repeat(64)}
 assert.equal(backup.validateBackupShape(doc,'project'),doc)
 assert.throws(()=>backup.validateBackupShape(doc,'different'))
 const damaged=structuredClone(doc);delete damaged.snapshot.tables.trades;assert.throws(()=>backup.validateBackupShape(damaged,'project'))
 assert.equal(backup.validStoragePath('trade-images','trades/1/a.png'),true)
 for(const [bucket,path] of [['trade-images','../a'],['trade-images','trades/1/../../x'],['journal-backups','exports/a.json'],['trade-executions','a.json']])assert.equal(backup.validStoragePath(bucket,path),false)
 assert.equal(backup.canonicalJSON({b:2,a:[{z:3,x:1}]}),backup.canonicalJSON({a:[{x:1,z:3}],b:2}))
})
test('aborted navigation requests remain AbortError rather than false network failures',async()=>{
 const previous=global.fetch;global.fetch=async()=>{throw new DOMException('Aborted','AbortError')}
 try{await assert.rejects(request.journalFetch('/api/trades'),error=>error.name==='AbortError')}finally{global.fetch=previous}
})

test('same-trade refreshes do not replace an unsaved notes draft',async()=>{
 let view
 await act(async()=>{view=Renderer.create(React.createElement(TradeModal,{trade,trades:[trade],tags,onClose(){},onNavigate(){}}))})
 await act(async()=>button(view.root,'Review').props.onClick())
 const field=view.root.findAllByType('textarea').find(node=>node.props.value==='Original')
 await act(async()=>field.props.onChange({target:{value:'Still editing'}}))
 await act(async()=>view.update(React.createElement(TradeModal,{trade:{...trade,notes:'Another window edit',journal_revision:4},trades:[trade],tags,onClose(){},onNavigate(){}})))
 assert.ok(view.root.findAllByType('textarea').some(node=>node.props.value==='Still editing'))
 view.unmount()
})

test('one-action review saves the lesson and Reviewed tag together, preserves tags, then advances',async()=>{
 const previous=global.fetch;let payload,navigated,saved,view
 const next={...trade,id:2,tag_ids:[],journal_revision:0,notes:''}
 global.fetch=async(url,init)=>{payload=JSON.parse(init.body);return new Response(JSON.stringify({success:true,trade:{...trade,note_lessons:payload.note_lessons,journal_revision:4,tag_ids:payload.tagIds}}))}
 try{
  await act(async()=>{view=Renderer.create(React.createElement(TradeModal,{trade,trades:[trade,next],tags,onClose(){},onNavigate:t=>{navigated=t},onSaved:t=>{saved=t}}))})
  await act(async()=>button(view.root,'Review').props.onClick())
  const lesson=view.root.findAllByType('textarea').find(node=>node.props['aria-label']==='One lesson for next time')
  await act(async()=>lesson.props.onChange({target:{value:'Wait for the retest before adding.'}}))
  await act(async()=>button(view.root,'Save, mark reviewed & next').props.onClick())
  assert.equal(payload.note_lessons,'Wait for the retest before adding.')
  assert.deepEqual(payload.tagIds,[7,9])
  assert.equal(saved.note_lessons,'Wait for the retest before adding.')
  assert.equal(navigated.id,2)
 }finally{view?.unmount();global.fetch=previous}
})

function backupService() {
 const output={}
 const compiled=transformSync(readFileSync(new URL('../lib/backupStore.js',import.meta.url),'utf8'),{filename:'backupStore.js',jsc:{parser:{syntax:'ecmascript'},target:'es2020'},module:{type:'commonjs'}}).code
 vm.runInNewContext(compiled,{exports:output,require:path=>path==='./backupFormat'?backup:require(path),process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.co'}},Buffer,URL,console})
 return output
}
function memoryJournal() {
 const files=new Map([['trade-images/trades/1/a.png',Buffer.from('image-bytes')]])
 const records=new Map()
 let calls=0,changeDuringExport=false
 const snapshot={schema:'schema',digest:'first',tables:Object.fromEntries(backup.BACKUP_TABLES.map(t=>[t,[]]))}
 snapshot.tables.trades=[{id:1,notes:'Keep me'}]
 snapshot.tables.trade_images=[{id:1,url:'https://project.supabase.co/storage/v1/object/public/trade-images/trades/1/a.png'}]
 const client={
  rpc:async name=>{calls++;return {data:structuredClone({...snapshot,digest:changeDuringExport && calls>1?'changed':snapshot.digest})}},
  from:()=>({
   insert:record=>({select:()=>({single:async()=>{
    const value={...record,created_at:'2026-10-26T10:00:00Z'}
    records.set(record.id,value)
    return {data:value}
   }})}),
   select:()=>({eq:(key,id)=>({single:async()=>({data:records.get(id)})})}),
  }),
  storage:{from:bucket=>({
   list:async prefix=>{
    const children=new Map()
    for(const key of files.keys())if(key.startsWith(bucket+'/'+(prefix?prefix+'/':''))){const rest=key.slice((bucket+'/'+(prefix?prefix+'/':'')).length),parts=rest.split('/');children.set(parts[0],{name:parts[0],id:parts.length===1?'file-id':null})}
    return {data:[...children.values()]}
   },
   download:async path=>files.has(bucket+'/'+path)?{data:new Blob([files.get(bucket+'/'+path)],{type:'application/octet-stream'})}:{error:{statusCode:404,message:'not found'}},
   upload:async(path,data)=>{files.set(bucket+'/'+path,Buffer.from(data));return {}},
  })},
 }
 return {client,files,records,change:()=>{changeDuringExport=true}}
}
test('full backup round-trips notes and attached bytes; damaged payloads are rejected',async()=>{
 const service=backupService(),state=memoryJournal()
 const {record,document}=await service.createFullBackup(state.client,{defaultTab:'tradelog'})
 assert.equal(document.files.length,1);assert.equal(document.snapshot.tables.trades[0].notes,'Keep me')
 const loaded=await service.readBackup(state.client,record.id)
 assert.equal(loaded.document.files[0].data,Buffer.from('image-bytes').toString('base64'))
 const changed=JSON.parse(state.files.get('journal-backups/'+record.path).toString());changed.snapshot.tables.trades[0].notes='Corrupted'
 state.files.set('journal-backups/'+record.path,Buffer.from(JSON.stringify(changed)))
 await assert.rejects(service.readBackup(state.client,record.id),/checksum/)
})
test('backup rejects concurrent changes and missing referenced screenshots',async()=>{
 const service=backupService(),state=memoryJournal();state.change()
 await assert.rejects(service.createFullBackup(state.client),/changed during backup/)
 assert.equal(state.records.size,0)
 const missing=memoryJournal();missing.files.clear()
 await assert.rejects(service.createFullBackup(missing.client),/missing stored bytes/)
 assert.equal(missing.records.size,0)
})
