import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import vm from 'node:vm'
import React from 'react'
import Renderer,{act} from 'react-test-renderer'
const require=createRequire(import.meta.url),{transformSync}=require('next/dist/build/swc')
const code=transformSync(readFileSync(new URL('../components/JournalShell.js',import.meta.url),'utf8'),{filename:'JournalShell.jsx',jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}).code,exports={}
vm.runInNewContext(code,{exports,require,document:{addEventListener(){},removeEventListener(){}}})
const {default:Shell,sectionFor}=exports
const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node?.children?.map(text).join('')||''
const props={tab:'overview',onTab(){},accounts:[{id:'A',label:'Primary',broker:'Exchange'},{id:'B',label:'Second',broker:'Exchange'}],selectedAccounts:new Set(),onAccounts(){},datePreset:'YTD',dateFrom:'2026-01-01',dateTo:'2026-10-26',onPreset(){},onCustom(){},count:2,onPrivacy(){},onTheme(){},onSettings(){},onImport(){}}
test('all existing analytical screens remain reachable within the five navigation groups',()=>{for(const tab of ['edge','symbols','timing','streaks','calendar','portfolio'])assert.equal(sectionFor(tab),'analysis');assert.equal(sectionFor('missed'),'review');assert.equal(sectionFor('trades'),'trades')})
test('scope can select one account directly without exposing deletion beside selection',async()=>{let selected;let view;await act(async()=>{view=Renderer.create(React.createElement(Shell,{...props,onAccounts:s=>{selected=s}}))});const buttons=()=>view.root.findAllByType('button');await act(async()=>buttons().find(b=>text(b)==='AccountsAll accounts⌄').props.onClick());assert.equal(buttons().some(b=>/Delete/.test(text(b))),false);await act(async()=>buttons().find(b=>b.props['aria-label']==='View only Primary').props.onClick());assert.deepEqual([...selected],['A']);view.unmount()})
test('selecting a reporting period closes the popover and preserves the requested preset',async()=>{let selected;let view;await act(async()=>{view=Renderer.create(React.createElement(Shell,{...props,onPreset:p=>{selected=p}}))});const buttons=()=>view.root.findAllByType('button');await act(async()=>buttons().find(b=>text(b)==='PeriodYTD⌄').props.onClick());await act(async()=>buttons().find(b=>text(b)==='All history').props.onClick());assert.equal(selected,'All');assert.equal(buttons().some(b=>text(b)==='Custom dates'),false);view.unmount()})
