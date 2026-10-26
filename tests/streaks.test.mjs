import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const require = createRequire(new URL('../components/Charts.js', import.meta.url))
const { transform } = require('next/dist/build/swc')
const source = await readFile(new URL('../components/Charts.js', import.meta.url), 'utf8')
const { code } = await transform(source, { filename:'Charts.jsx',
  jsc:{ parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}} }, module:{type:'commonjs'} })
const module = {exports:{}}
vm.runInNewContext(code, {require,module,exports:module.exports,console})
const ChartComp = module.exports.default
const render = trades => renderToStaticMarkup(React.createElement(ChartComp, {
 type:'streaks',trades,stats:{overview:{max_win_streak:2,max_loss_streak:2}},privacy:false,
}))
const trade = (id,pnl,entry_time,exit_time) => ({id,symbol:id,pnl,entry_time,exit_time})

test('Streaks renders trades without entry dates instead of crashing', () => {
 const html=render([trade('A',1,null,'2026-10-01T12:00:00Z'),trade('B',-1,null,'2026-10-02T12:00:00Z')])
 assert.match(html,/TRADE OUTCOME TIMELINE/)
 assert.match(html,/TOP WIN STREAKS/)
 assert.match(html,/TOP LOSS STREAKS/)
 assert.doesNotMatch(html,/undefined/)
})

test('timeline, current run and table boundaries follow realised dates', () => {
 const html=render([
  trade('A',-1,'2026-10-01T12:00:00Z','2026-10-04T12:00:00Z'),
  trade('B',1,'2026-10-02T10:00:00Z','2026-10-02T12:00:00Z'),
  trade('C',1,null,'2026-10-03T12:00:00Z'),
  trade('D',-1,'2026-10-05T12:00:00Z',null),
 ])
 assert.match(html,/CURRENT STREAK<\/div><div[^>]*>2 losses<\/div>/)
 const positions=['B','C','A','D'].map(id=>html.indexOf(`title="${id} `))
 assert.ok(positions.every(index=>index>=0))
 assert.deepEqual([...positions].sort((a,b)=>a-b),positions)
 const topWins=html.slice(html.indexOf('TOP WIN STREAKS'),html.indexOf('TOP LOSS STREAKS'))
 assert.match(topWins,/2026-10-02/)
 assert.match(topWins,/2026-10-03/)
})

test('missing both dates and empty data have safe output', () => {
 assert.doesNotThrow(()=>render([trade('A',1,null,null),trade('B',-1,null,'2026-10-02T12:00:00Z')]))
 assert.match(render([trade('A',1,null,null)]),/Unknown date/)
 assert.match(render([]),/No trade data to show streaks/)
})
