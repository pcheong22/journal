import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=readFileSync(new URL('../lib/pretradeChecklist.js',import.meta.url),'utf8')
const checklist=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))

const strong={symbol:'CRUDE',direction:'Long',setup_type:'Pivot reclaim',pivot_timeframe:'Monthly',pivot_name:'Monthly pivot',entry_price:100,stop_price:98,target_price:104,invalidation:'Acceptance below the monthly pivot',checks:Object.fromEntries(checklist.CHECKLIST_ITEMS.map(item=>[item.id,item.max]))}

test('checklist weights total 100 with 35 points reserved for pivots',()=>{
  assert.equal(checklist.CHECKLIST_SECTIONS.reduce((sum,section)=>sum+section.weight,0),100)
  assert.equal(checklist.CHECKLIST_SECTIONS.find(section=>section.id==='pivots').weight,35)
  assert.equal(checklist.CHECKLIST_ITEMS.reduce((sum,item)=>sum+item.max,0),100)
})

test('a complete high-conviction plan receives A+ and passes every hard gate',()=>{
  const result=checklist.evaluatePlan(strong)
  assert.equal(result.score,100);assert.equal(result.grade,'A+');assert.equal(result.ready,true);assert.equal(result.reward_risk,2)
  assert.ok(Object.values(result.gates).every(Boolean))
})

test('score cannot override missing trigger, invalidation or 1.5R gate',()=>{
  const result=checklist.evaluatePlan({...strong,target_price:102,checks:{...strong.checks,entry_trigger:3}})
  assert.equal(result.grade,'Incomplete');assert.equal(result.ready,false);assert.equal(result.gates.trigger,false);assert.equal(result.gates.reward,false)
})

test('invalid checklist values are rejected during normalization',()=>{
  const result=checklist.evaluatePlan({...strong,checks:{...strong.checks,pivot_significance:999}})
  assert.equal(result.checks.pivot_significance,0)
})
