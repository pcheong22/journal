import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import vm from 'node:vm'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

const require=createRequire(import.meta.url)
const {transformSync}=require('next/dist/build/swc')
const source=path=>readFileSync(new URL(path,import.meta.url),'utf8')

test('deferred views announce useful loading feedback',()=>{
 const compiled=transformSync(source('../components/ViewLoading.js'),{filename:'ViewLoading.jsx',jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}).code
 const moduleExports={}
 vm.runInNewContext(compiled,{exports:moduleExports,require})
 const markup=renderToStaticMarkup(React.createElement(moduleExports.default,{label:'Preparing analysis'}))
 assert.match(markup,/role="status"/)
 assert.match(markup,/aria-live="polite"/)
 assert.match(markup,/Preparing analysis/)
})

test('analysis tabs, sortable columns and image controls are keyboard operable',()=>{
 const page=source('../pages/index.js')
 const edge=source('../components/EdgeDiscovery.js')
 const images=source('../components/ImageGallery.js')
 assert.match(page,/role="tablist"/)
 assert.match(page,/role="tab" aria-selected=/)
 assert.match(page,/className="sort-button"/)
 assert.match(edge,/tabIndex=\{0\}/)
 assert.match(edge,/function SortButton/)
 assert.match(images,/role="button" tabIndex=\{0\} aria-label="Attach screenshots"/)
 assert.match(images,/role="dialog" aria-modal="true" aria-label="Screenshot preview"/)
})

test('calendar cells expose date, result direction and trade count without relying on colour',()=>{
 const page=source('../pages/index.js')
 assert.match(page,/role="gridcell" aria-label=/)
 assert.match(page,/role="grid" aria-label=/)
 assert.match(page,/profit.*loss/s)
})

test('mobile utility controls retain practical touch targets',()=>{
 const css=source('../styles/ledger.css')
 assert.match(css,/@media\(max-width:768px\)[\s\S]*\.header-icon\{width:44px;height:44px/)
 assert.match(css,/\.primary-nav button,\.secondary-nav button\{min-height:44px\}/)
 assert.match(css,/\.scope-trigger\{min-height:44px\}/)
})
