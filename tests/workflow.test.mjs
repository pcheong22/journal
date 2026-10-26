import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const {draftKey,readNoteDraft,writeNoteDraft,NOTE_TEMPLATES}=await import('data:text/javascript;base64,'+Buffer.from(readFileSync(new URL('../lib/noteDraft.js',import.meta.url),'utf8')).toString('base64'))
const memory=new Map(),storage={getItem:key=>memory.get(key),setItem:(key,value)=>memory.set(key,value)},trade={id:7,account_id:'WALLET'}
test('note drafts survive reload with identity and revision metadata',()=>{writeNoteDraft(storage,trade,{notes:'My reasoning',stop_loss:'90'},3);const draft=readNoteDraft(storage,trade);assert.equal(draft.values.notes,'My reasoning');assert.equal(draft.values.stop_loss,'90');assert.equal(draft.revision,3);assert.equal(readNoteDraft(storage,{...trade,id:8}),null);assert.notEqual(draftKey(trade),draftKey({...trade,account_id:'OTHER'}))})
test('damaged and oversized drafts are rejected and template prompts are explicit',()=>{storage.setItem(draftKey(trade),'not json');assert.equal(readNoteDraft(storage,trade),null);assert.ok(NOTE_TEMPLATES['Execution review'].note_lessons);writeNoteDraft(storage,trade,{notes:'a'.repeat(25000)},4);assert.equal(readNoteDraft(storage,trade).values.notes.length,20000)})
