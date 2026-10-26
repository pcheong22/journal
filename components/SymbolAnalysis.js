import { Fragment, useMemo, useState } from 'react'
import ChartComp from './Charts'
import { symbolReport } from '../lib/symbols'
const money = value => value == null ? 'Currency review needed' : value.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0})
const percent = value => `${(value*100).toFixed(1)}%`
export default function SymbolAnalysis({trades,privacy,onSelect}) {
  const [mode,setMode]=useState('family'),[expanded,setExpanded]=useState(new Set())
  const rows=useMemo(()=>symbolReport(trades,mode),[trades,mode])
  const chartRows=rows.filter(row=>row.comparable).slice(0,14)
  const toggle = key => setExpanded(current=>{const next=new Set(current);next.has(key)?next.delete(key):next.add(key);return next})
  const metrics = row => <>
    <td>{row.count}</td><td className={`${row.total_pnl>=0?'pos':'neg'} private`}>{privacy?'***':money(row.total_pnl)}</td>
    <td>{percent(row.win_rate)}</td><td className="private">{privacy?'***':money(row.avg_pnl)}</td>
    <td style={{whiteSpace:'nowrap',fontSize:11}}><span className="pos">{row.bullish} bullish</span> · <span className="neg">{row.bearish} bearish</span></td>
    <td>{!row.comparable ? 'Review currency' : row.total_pnl>10000&&row.win_rate>.65 ? <span className="pill pb">KEEP</span> : row.total_pnl < -10000 ? <span className="pill pr">REDUCE</span> : <span className="pill pn">MONITOR</span>}</td>
  </>
  return <div className="anim">
    <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',marginBottom:14}}>
      <div><div style={{fontSize:15,fontWeight:700,marginBottom:5}}>Symbol performance</div><div style={{fontSize:11,color:'var(--mu)'}}>Shared market names across exchanges, with distinct ETF products preserved.</div></div>
      <div style={{display:'flex',gap:6}}>{[['family','Underlying families'],['product','Markets / products']].map(([value,label])=><button key={value} className="btn btn-sm" aria-pressed={mode===value} onClick={()=>setMode(value)} style={mode===value?{background:'var(--ac)',color:'#fff'}:{}}>{label}</button>)}</div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}} className="g2">
      <ChartComp type="symbolPnl" data={chartRows} privacy={privacy}/><ChartComp type="symbolWr" data={chartRows}/>
    </div>
    <div className="card">
      <div className="ct"><span className="ind"/>{mode==='family'?'UNDERLYING FAMILY BREAKDOWN':'MARKET / PRODUCT BREAKDOWN'}</div>
      <div style={{fontSize:11,color:'var(--mu)',lineHeight:1.7,marginBottom:12}}>
        {mode==='family'?'Crude oil includes CRUDE contracts and USO. Bitcoin includes BTC/USD, IBIT, BITO and BITI when present. Expand a family to inspect its products.':'CRUDE includes CRUDE/USD, WTI/USD and dated CL contracts. ETF symbols stay distinct.'}<br/>
        Exposure describes the underlying market: a long BITI trade is bearish Bitcoin exposure. Trade direction is retained in the Trade Log.
      </div>
      <div className="tw"><table style={{minWidth:820,width:'100%'}}>
        <thead><tr>{[mode==='family'?'Family / product':'Market / product','Trades','Journal P&L','Win rate','Avg P&L','Underlying exposure','Assessment','Details'].map(label=><th key={label}>{label}</th>)}</tr></thead>
        <tbody>{rows.map(row=><Fragment key={row.symbol}>
          <tr><td className="sym-c">{mode==='family'&&row.products.length>1?<button className="btn btn-sm" aria-label={`${expanded.has(row.symbol)?'Collapse':'Expand'} ${row.symbol}`} aria-expanded={expanded.has(row.symbol)} onClick={()=>toggle(row.symbol)}>{expanded.has(row.symbol)?'▾':'▸'} {row.symbol}</button>:row.symbol}{row.products.length===1&&row.products[0].inverse&&<span className="pill" style={{color:'var(--wa)',marginLeft:6}}>Daily inverse</span>}</td>
            {metrics(row)}<td><button className="btn btn-sm" onClick={()=>onSelect(row.symbol,mode==='family' && ['Crude oil','Bitcoin'].includes(row.symbol))}>View trades</button></td></tr>
          {mode==='family'&&expanded.has(row.symbol)&&row.products.map(product=><tr key={product.symbol} style={{background:'var(--sf2)'}}>
            <td style={{paddingLeft:24}}><div style={{fontWeight:600}}>{product.symbol}{product.inverse&&<span className="pill" style={{color:'var(--wa)',marginLeft:6}}>Daily inverse</span>}</div><div style={{fontSize:10,color:'var(--mu)',marginTop:4}}>{product.product_type==='Broker instrument'?'Exchange contracts / instruments':product.product_type}</div><div style={{fontSize:9,color:'var(--mu)',marginTop:3}}>Saved tickers: {product.aliases.join(', ')}</div></td>
            {metrics(product)}<td><button className="btn btn-sm" onClick={()=>onSelect(product.symbol,false)}>View trades</button></td>
          </tr>)}
        </Fragment>)}</tbody>
      </table></div>
      <div style={{fontSize:10,color:'var(--mu)',lineHeight:1.7,marginTop:12}}>P&L uses the journal's existing USD, USDC and USDT reporting amounts. Family totals sum trades; win rates are calculated from individual results. Prices, quantities and execution costs remain specific to each traded product.</div>
    </div>
  </div>
}
