import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const pivots=await import('data:text/javascript;base64,'+Buffer.from(readFileSync(new URL('../lib/pivots.js',import.meta.url),'utf8')).toString('base64'))

test('traditional pivots match the published floor-pivot formula through R5 and S5',()=>{
  assert.deepEqual(pivots.traditionalPivots({high:110,low:90,close:100}),{P:100,R1:110,S1:90,R2:120,S2:80,R3:130,S3:70,R4:140,S4:60,R5:150,S5:50})
})

test('calendar boundaries use Monday weeks and standard UTC month, quarter and year starts',()=>{
  const time='2026-10-27T23:30:00Z'
  assert.equal(new Date(pivots.periodStart(time,'Weekly')*1000).toISOString(),'2026-10-26T00:00:00.000Z')
  assert.equal(new Date(pivots.periodStart(time,'Monthly')*1000).toISOString(),'2026-10-01T00:00:00.000Z')
  assert.equal(new Date(pivots.periodStart(time,'Quarterly')*1000).toISOString(),'2026-10-01T00:00:00.000Z')
  assert.equal(new Date(pivots.periodStart(time,'Yearly')*1000).toISOString(),'2026-01-01T00:00:00.000Z')
})

test('a trade receives nearest pivots calculated only from completed prior UTC periods',()=>{
  const day=(iso,open,high,low,close)=>({time:Date.parse(iso)/1000,open,high,low,close})
  const candles=[day('2025-12-29T00:00:00Z',98,110,90,100),day('2025-12-31T00:00:00Z',100,108,95,100),day('2026-01-01T00:00:00Z',100,105,96,101),day('2026-01-05T00:00:00Z',101,500,1,400)]
  const context=pivots.pivotContext(candles,{entry_time:'2026-01-06T12:00:00Z',entry_price:101})
  const yearly=context.timeframes.find(item=>item.timeframe==='Yearly'),weekly=context.timeframes.find(item=>item.timeframe==='Weekly')
  assert.equal(yearly.source_period.high,110);assert.equal(yearly.source_period.low,90);assert.equal(yearly.levels.P,100);assert.equal(yearly.nearest.name,'P')
  assert.equal(weekly.source_period.start,Date.parse('2025-12-29T00:00:00Z')/1000)
  assert.equal(weekly.source_period.high,110)
})

test('nearest pivot reports distance and the entry side without mutating prices',()=>{
  const result=pivots.nearestPivot(101,{P:100,R1:110,S1:90})
  assert.equal(result.name,'P');assert.equal(result.entry_side,'above');assert.ok(Math.abs(result.distance_pct-100/101)<1e-12)
})
