import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import vm from 'node:vm'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
const require=createRequire(import.meta.url),{transformSync}=require('next/dist/build/swc')
const source=readFileSync(new URL('../pages/index.js',import.meta.url),'utf8'),start=source.indexOf('function SettingsPanel('),end=source.indexOf('\n}',start)+2
const code=transformSync('export '+source.slice(start,end),{filename:'SettingsPanel.jsx',jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}).code,exports={}
vm.runInNewContext(code,{exports,require,React,useRef:()=>({current:null}),useCallback:fn=>fn,useDialogFocus(){},BackupPanel:()=>null,ImportHistory:()=>null,DashboardLayoutOrder:()=>null,DashboardOrderEditor:()=>null,DashboardOrderList:()=>null})
test('every settings tab option renders a text label, including Edge',()=>{const html=renderToStaticMarkup(React.createElement(exports.SettingsPanel,{settings:{defaultTab:'edge',dashboardOrder:[]},saveSetting(){},onClose(){}}));assert.match(html,/>Edge<\/option>/)})
