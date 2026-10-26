import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),{transformSync}=require('next/dist/build/swc'),original=require.extensions['.js']
require.extensions['.js']=(module,file)=>{if(file.includes('/journal/lib/'))module._compile(transformSync(readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'ecmascript'},target:'es2020'},module:{type:'commonjs'}}).code,file);else original(module,file)}
const {computeStats,simulatePnLPath}=require('../lib/tradeUtils.js'),{computeStreaks,calculateNotionalUSD,parseDate}=require('../lib/parserUtils.js'),{escapeHTML,validateCoachReport}=require('../lib/reportSafety.js')
const rows=[10,0,20,-5,0,-10].map((pnl,i)=>({id:i,pnl,symbol:'BTC',direction:'Long',currency:'USDC',exit_time:`2026-01-0${i+1}T12:00:00Z`}))
test('breakeven is neutral, included in win-rate denominator, and breaks consecutive runs',()=>{const s=computeStats(rows).overview;assert.equal(s.total_pnl,15);assert.equal(s.breakeven_count,2);assert.equal(s.win_rate,2/6);assert.equal(s.max_win_streak,1);assert.equal(s.max_loss_streak,1);assert.deepEqual(computeStreaks(rows).map(t=>t.streak_id),['W1','B0','W1','L1','B0','L1'])})
test('short returns use entry as denominator and notional matches the same move',()=>{assert.equal(calculateNotionalUSD(10,100,90,1,'Short').notional_usd,100);assert.equal(calculateNotionalUSD(-10,100,110,1,'Short').notional_usd,100)})
test('portfolio ratios and simulated execution scores stay unavailable without measured history',()=>{const s=computeStats(rows).overview;for(const key of ['calmar','sharpe','sortino','kelly_full','kelly_half','ror_half','ror_ruin','ulcer_index'])assert.equal(s[key],null);assert.equal(simulatePnLPath(rows[0]),null)})
test('print reports escape active HTML and model responses have bounded validated fields',()=>{assert.equal(escapeHTML('<img src=x onerror="alert(1)">'),'&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');const r=validateCoachReport({score:999,insights:[{type:'<script>',title:'x'}],stub:true});assert.equal(r.score,100);assert.equal(r.insights[0].type,'opportunity');assert.equal('stub' in r,false)})
test('slash dates use the documented day-first convention before native US parsing',()=>{assert.equal(parseDate('05/06/2026 12:30').toISOString(),'2026-06-05T12:30:00.000Z')})
