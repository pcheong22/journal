// components/EdgeDiscovery.jsx
// Edge Discovery + Where My Edge Lives + Performance Simulator
// Matches TradeIntel styling: --bg #0c1117, --ac #66ffa5, Barlow + JetBrains Mono

import { useState, useMemo } from 'react'
import DrawdownAttribution from './DrawdownAttribution'

// ── Helpers ───────────────────────────────────────────────────────────────────
const fU  = (n, d=0) => (n>=0?'+':'')+n.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:d,maximumFractionDigits:d})
const fA  = n => '$'+Math.abs(n).toLocaleString('en-US',{maximumFractionDigits:0})
const fP  = (n,d=1) => (n*100).toFixed(d)+'%'
const fN  = (n,d=2) => n==null?'—':n.toFixed(d)

function expectancy(trades) {
  if (!trades.length) return 0
  const wins   = trades.filter(t => t.pnl > 0)
  const losses = trades.filter(t => t.pnl < 0)
  const wr     = wins.length / trades.length
  const avgW   = wins.length   ? wins.reduce((s,t)=>s+t.pnl,0)/wins.length   : 0
  const avgL   = losses.length ? losses.reduce((s,t)=>s+t.pnl,0)/losses.length : 0
  return wr * avgW + (1 - wr) * avgL
}

function profitFactor(trades) {
  const gross = trades.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0)
  const loss  = Math.abs(trades.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0))
  return loss === 0 ? (gross > 0 ? Infinity : 0) : gross / loss
}

function bucketLabel(d) {
  if (d == null) return 'Unknown'
  if (d < 5)    return '<5m'
  if (d < 15)   return '5-15m'
  if (d < 60)   return '15-60m'
  if (d < 240)  return '1-4h'
  if (d < 1440) return '4-24h'
  return '>24h'
}

const BUCKETS  = ['<5m','5-15m','15-60m','1-4h','4-24h','>24h']
const DOW_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
const MIN_TRADES = 5 // minimum trades to colour a heatmap cell

// ── Colour helpers ────────────────────────────────────────────────────────────
function heatColor(val, min, max) {
  if (val == null || isNaN(val)) return 'transparent'
  const mid = 0
  if (val >= mid) {
    const t = Math.min(1, (val - mid) / (Math.max(max, 0.01) - mid))
    return `rgba(102,255,165,${(0.08 + t * 0.35).toFixed(2)})`
  } else {
    const t = Math.min(1, (mid - val) / (mid - Math.min(min, -0.01)))
    return `rgba(255,82,88,${(0.08 + t * 0.35).toFixed(2)})`
  }
}

function heatTextColor(val) {
  if (val == null || isNaN(val)) return 'var(--mu)'
  return val >= 0 ? '#66ffa5' : '#ff5258'
}

// ── Shared table styles ───────────────────────────────────────────────────────
const TH = { fontSize:9, fontWeight:700, color:'var(--mu)', textTransform:'uppercase',
  letterSpacing:'.08em', fontFamily:'var(--font-mono)', padding:'7px 12px',
  borderBottom:'1px solid var(--bd)', whiteSpace:'nowrap', cursor:'pointer', userSelect:'none' }
const TD = { fontSize:11, fontFamily:'var(--font-mono)', padding:'7px 12px',
  borderBottom:'1px solid var(--bd2)', whiteSpace:'nowrap' }

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ title, sub }) {
  return (
    <div style={{marginBottom:16}}>
      <div style={{fontSize:13,fontWeight:700,color:'var(--tx)',letterSpacing:'.01em'}}>{title}</div>
      {sub && <div style={{fontSize:11,color:'var(--mu)',marginTop:3}}>{sub}</div>}
    </div>
  )
}

// ── Card wrapper ──────────────────────────────────────────────────────────────
function Card({ children, style }) {
  return (
    <div style={{background:'var(--sf)',border:'1px solid var(--bd)',borderRadius:10,padding:20,overflow:'hidden',...style}}>
      {children}
    </div>
  )
}

// ── Sort indicator ────────────────────────────────────────────────────────────
function SortInd({ col, sortKey, sortDir }) {
  if (sortKey !== col) return <span style={{opacity:.3}}>⇅</span>
  return <span style={{color:'var(--ac)'}}>{sortDir===1?'↑':'↓'}</span>
}

// ────────────────────────────────────────────────────────────────────────────
// TAB 1: Symbol Expectancy Table
// ────────────────────────────────────────────────────────────────────────────
function SymbolExpectancyTable({ trades }) {
  const [dirFilter, setDirFilter] = useState('all') // all | Long | Short
  const [sortKey,   setSortKey]   = useState('expectancy')
  const [sortDir,   setSortDir]   = useState(-1)
  const [drillSym,  setDrillSym]  = useState(null)

  const filtered = useMemo(() =>
    dirFilter === 'all' ? trades : trades.filter(t => t.direction === dirFilter),
  [trades, dirFilter])

  const rows = useMemo(() => {
    const bySymbol = {}
    filtered.forEach(t => {
      if (!bySymbol[t.symbol]) bySymbol[t.symbol] = []
      bySymbol[t.symbol].push(t)
    })
    return Object.entries(bySymbol).map(([symbol, ts]) => {
      const wins   = ts.filter(t => t.pnl > 0)
      const losses = ts.filter(t => t.pnl < 0)
      const wr     = wins.length / ts.length
      const avgW   = wins.length   ? wins.reduce((s,t)=>s+t.pnl,0)/wins.length   : 0
      const avgL   = losses.length ? losses.reduce((s,t)=>s+t.pnl,0)/losses.length : 0
      const exp    = expectancy(ts)
      const pf     = profitFactor(ts)
      const total  = ts.reduce((s,t)=>s+t.pnl,0)
      return { symbol, trades:ts.length, wr, avgW, avgL, pf, expectancy:exp, total }
    })
  }, [filtered])

  const sorted = useMemo(() => [...rows].sort((a,b) => sortDir*(a[sortKey]-b[sortKey])), [rows, sortKey, sortDir])

  const toggleSort = col => {
    if (sortKey === col) setSortDir(d => d * -1)
    else { setSortKey(col); setSortDir(-1) }
  }

  const drillTrades = drillSym ? filtered.filter(t => t.symbol === drillSym) : []

  const COLS = [
    ['symbol',     'Symbol',    false],
    ['trades',     'Trades',    false],
    ['wr',         'Win Rate',  false],
    ['avgW',       'Avg Win',   false],
    ['avgL',       'Avg Loss',  false],
    ['pf',         'Prof.Factor', false],
    ['expectancy', 'Expectancy',  false],
    ['total',      'Total P&L', false],
  ]

  return (
    <Card>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16,flexWrap:'wrap',gap:8}}>
        <SectionHeader title="Symbol Expectancy" sub="Sorted by expectancy — reveals true edge per instrument" />
        <div style={{display:'flex',gap:6}}>
          {['all','Long','Short'].map(d => (
            <button key={d} onClick={()=>setDirFilter(d)}
              style={{padding:'4px 12px',borderRadius:5,border:`1px solid ${dirFilter===d?'var(--ac)':'var(--bd)'}`,
                background:dirFilter===d?'var(--ac-bg)':'transparent',color:dirFilter===d?'var(--ac2)':'var(--mu)',
                fontSize:11,cursor:'pointer',fontFamily:'var(--font-mono)',fontWeight:600,transition:'all .15s'}}>
              {d === 'all' ? 'Both' : d}
            </button>
          ))}
        </div>
      </div>

      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead>
            <tr>
              {COLS.map(([key,label]) => (
                <th key={key} style={{...TH,textAlign:key==='symbol'?'left':'right'}} onClick={()=>toggleSort(key)}>
                  {label} <SortInd col={key} sortKey={sortKey} sortDir={sortDir} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.symbol}
                onClick={() => setDrillSym(prev => prev === r.symbol ? null : r.symbol)}
                style={{cursor:'pointer',background:drillSym===r.symbol?'var(--ac-bg)':'transparent',transition:'background .1s'}}
                onMouseEnter={e=>e.currentTarget.style.background=drillSym===r.symbol?'var(--ac-bg)':'var(--sf2)'}
                onMouseLeave={e=>e.currentTarget.style.background=drillSym===r.symbol?'var(--ac-bg)':'transparent'}>
                <td style={{...TD,fontWeight:700,color:'var(--tx)'}}>{r.symbol}</td>
                <td style={{...TD,textAlign:'right',color:'var(--mu)'}}>{r.trades}</td>
                <td style={{...TD,textAlign:'right',color:r.wr>=.5?'#66ffa5':'#ff5258'}}>{fP(r.wr)}</td>
                <td style={{...TD,textAlign:'right',color:'#66ffa5'}}>{fU(r.avgW)}</td>
                <td style={{...TD,textAlign:'right',color:'#ff5258'}}>{fU(r.avgL)}</td>
                <td style={{...TD,textAlign:'right',color:r.pf>=1?'#66ffa5':'#ff5258'}}>{r.pf===Infinity?'∞':fN(r.pf)}</td>
                <td style={{...TD,textAlign:'right',fontWeight:700,color:heatTextColor(r.expectancy)}}>{fU(r.expectancy)}</td>
                <td style={{...TD,textAlign:'right',color:r.total>=0?'#66ffa5':'#ff5258',fontWeight:600}}>{fU(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Drill-down panel */}
      {drillSym && drillTrades.length > 0 && (
        <div style={{marginTop:16,padding:16,background:'var(--sf2)',borderRadius:8,border:'1px solid var(--bd)'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
            <div style={{fontWeight:700,fontSize:12,color:'var(--ac)'}}>{drillSym} — by duration</div>
            <button onClick={()=>setDrillSym(null)} style={{background:'none',border:'none',color:'var(--mu)',cursor:'pointer',fontSize:12}}>✕</button>
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr>
                  {['Bucket','Trades','Win Rate','Avg Win','Avg Loss','Expectancy','Total'].map(h => (
                    <th key={h} style={{...TH,textAlign:h==='Bucket'?'left':'right'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {BUCKETS.map(b => {
                  const bts = drillTrades.filter(t => bucketLabel(t.duration_mins) === b)
                  if (!bts.length) return null
                  const wins = bts.filter(t=>t.pnl>0)
                  const losses = bts.filter(t=>t.pnl<0)
                  const wr = wins.length/bts.length
                  const avgW = wins.length ? wins.reduce((s,t)=>s+t.pnl,0)/wins.length : 0
                  const avgL = losses.length ? losses.reduce((s,t)=>s+t.pnl,0)/losses.length : 0
                  const exp = expectancy(bts)
                  const total = bts.reduce((s,t)=>s+t.pnl,0)
                  return (
                    <tr key={b}>
                      <td style={{...TD,fontWeight:600,color:'var(--tx)'}}>{b}</td>
                      <td style={{...TD,textAlign:'right',color:'var(--mu)'}}>{bts.length}</td>
                      <td style={{...TD,textAlign:'right',color:wr>=.5?'#66ffa5':'#ff5258'}}>{fP(wr)}</td>
                      <td style={{...TD,textAlign:'right',color:'#66ffa5'}}>{fU(avgW)}</td>
                      <td style={{...TD,textAlign:'right',color:'#ff5258'}}>{fU(avgL)}</td>
                      <td style={{...TD,textAlign:'right',fontWeight:700,color:heatTextColor(exp)}}>{fU(exp)}</td>
                      <td style={{...TD,textAlign:'right',color:total>=0?'#66ffa5':'#ff5258',fontWeight:600}}>{fU(total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// TAB 2: Duration Expectancy Table
// ────────────────────────────────────────────────────────────────────────────
function DurationExpectancyTable({ trades }) {
  const rows = useMemo(() => BUCKETS.map(b => {
    const ts = trades.filter(t => bucketLabel(t.duration_mins) === b)
    if (!ts.length) return { bucket:b, trades:0, wr:0, avgW:0, avgL:0, pf:0, expectancy:0, total:0, avgTrade:0 }
    const wins   = ts.filter(t=>t.pnl>0)
    const losses = ts.filter(t=>t.pnl<0)
    const wr     = wins.length/ts.length
    const avgW   = wins.length   ? wins.reduce((s,t)=>s+t.pnl,0)/wins.length   : 0
    const avgL   = losses.length ? losses.reduce((s,t)=>s+t.pnl,0)/losses.length : 0
    return {
      bucket: b,
      trades: ts.length,
      wr, avgW, avgL,
      pf:    profitFactor(ts),
      expectancy: expectancy(ts),
      total: ts.reduce((s,t)=>s+t.pnl,0),
      avgTrade: ts.reduce((s,t)=>s+t.pnl,0)/ts.length,
    }
  }), [trades])

  // Bar chart scale
  const maxAbs = Math.max(...rows.map(r => Math.abs(r.total)), 1)

  return (
    <Card>
      <SectionHeader title="Duration Expectancy" sub="Where does the edge actually live by hold time?" />
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead>
            <tr>
              {['Duration','Trades','Win Rate','Avg Win','Avg Loss','Prof. Factor','Expectancy','Avg Trade','Total P&L'].map(h => (
                <th key={h} style={{...TH,textAlign:h==='Duration'?'left':'right'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.bucket} style={{background:r.trades===0?'transparent':'transparent'}}
                onMouseEnter={e=>e.currentTarget.style.background='var(--sf2)'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <td style={{...TD,fontWeight:700,color:'var(--tx)',minWidth:80}}>{r.bucket}</td>
                <td style={{...TD,textAlign:'right',color:r.trades===0?'var(--bd2)':'var(--mu)'}}>{r.trades||'—'}</td>
                <td style={{...TD,textAlign:'right',color:r.trades===0?'var(--bd2)':r.wr>=.5?'#66ffa5':'#ff5258'}}>{r.trades?fP(r.wr):'—'}</td>
                <td style={{...TD,textAlign:'right',color:'#66ffa5'}}>{r.trades?fU(r.avgW):'—'}</td>
                <td style={{...TD,textAlign:'right',color:'#ff5258'}}>{r.trades?fU(r.avgL):'—'}</td>
                <td style={{...TD,textAlign:'right',color:r.trades===0?'var(--bd2)':r.pf>=1?'#66ffa5':'#ff5258'}}>{r.trades?(r.pf===Infinity?'∞':fN(r.pf)):'—'}</td>
                <td style={{...TD,textAlign:'right',fontWeight:700,color:r.trades===0?'var(--bd2)':heatTextColor(r.expectancy)}}>{r.trades?fU(r.expectancy):'—'}</td>
                <td style={{...TD,textAlign:'right',color:r.trades===0?'var(--bd2)':r.avgTrade>=0?'#66ffa5':'#ff5258'}}>{r.trades?fU(r.avgTrade):'—'}</td>
                <td style={{...TD,textAlign:'right',minWidth:160}}>
                  {r.trades > 0 && (
                    <div style={{display:'flex',alignItems:'center',gap:8,justifyContent:'flex-end'}}>
                      <span style={{color:r.total>=0?'#66ffa5':'#ff5258',fontWeight:600}}>{fU(r.total)}</span>
                      <div style={{width:60,height:6,background:'var(--sf2)',borderRadius:3,overflow:'hidden'}}>
                        <div style={{height:'100%',width:`${Math.round(Math.abs(r.total)/maxAbs*100)}%`,
                          background:r.total>=0?'#66ffa5':'#ff5258',borderRadius:3,transition:'width .3s'}} />
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// TAB 3: Heatmaps
// ────────────────────────────────────────────────────────────────────────────
function HeatmapCell({ val, count, fmt }) {
  const bg  = count >= MIN_TRADES ? heatColor(val, -500, 500) : 'transparent'
  const col = count >= MIN_TRADES ? heatTextColor(val) : 'var(--bd2)'
  return (
    <td style={{...TD,textAlign:'center',padding:'6px 8px',background:bg,color:col,
      fontWeight:count>=MIN_TRADES?600:400,fontSize:10,minWidth:72,transition:'background .2s'}}>
      {count >= MIN_TRADES ? fmt(val) : count > 0 ? <span style={{fontSize:9,color:'var(--bd2)'}}>{count}t</span> : '—'}
    </td>
  )
}

function SymbolDurationHeatmap({ trades }) {
  const [metric, setMetric] = useState('expectancy')

  const symbols = useMemo(() => {
    const bySymbol = {}
    trades.forEach(t => {
      if (!bySymbol[t.symbol]) bySymbol[t.symbol] = []
      bySymbol[t.symbol].push(t)
    })
    return Object.entries(bySymbol)
      .map(([sym, ts]) => ({ sym, total: ts.reduce((s,t)=>s+t.pnl,0) }))
      .sort((a,b) => b.total - a.total)
      .slice(0, 20)
      .map(x => x.sym)
  }, [trades])

  const cells = useMemo(() => {
    const map = {}
    trades.forEach(t => {
      const b = bucketLabel(t.duration_mins)
      const k = `${t.symbol}|${b}`
      if (!map[k]) map[k] = []
      map[k].push(t)
    })
    return map
  }, [trades])

  const getVal = (sym, bucket) => {
    const ts = cells[`${sym}|${bucket}`] || []
    if (!ts.length) return { val: null, count: 0 }
    switch (metric) {
      case 'expectancy': return { val: expectancy(ts), count: ts.length }
      case 'winrate':    return { val: ts.filter(t=>t.pnl>0).length/ts.length*100, count: ts.length }
      case 'total':      return { val: ts.reduce((s,t)=>s+t.pnl,0), count: ts.length }
      default:           return { val: expectancy(ts), count: ts.length }
    }
  }

  const fmt = v => metric === 'winrate' ? v.toFixed(0)+'%' : metric === 'total' ? fU(v) : fU(v)

  return (
    <Card>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16,flexWrap:'wrap',gap:8}}>
        <SectionHeader title="Symbol × Duration Heatmap" sub={`Top 20 symbols by P&L. Cells with <${MIN_TRADES} trades shown dimmed.`} />
        <div style={{display:'flex',gap:6}}>
          {[['expectancy','Expectancy'],['winrate','Win Rate'],['total','Total P&L']].map(([v,l]) => (
            <button key={v} onClick={()=>setMetric(v)}
              style={{padding:'4px 10px',borderRadius:5,border:`1px solid ${metric===v?'var(--ac)':'var(--bd)'}`,
                background:metric===v?'var(--ac-bg)':'transparent',color:metric===v?'var(--ac2)':'var(--mu)',
                fontSize:11,cursor:'pointer',fontFamily:'var(--font-mono)',fontWeight:600}}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div style={{overflowX:'auto'}}>
        <table style={{borderCollapse:'collapse',width:'100%'}}>
          <thead>
            <tr>
              <th style={{...TH,textAlign:'left',minWidth:120}}>Symbol</th>
              {BUCKETS.map(b => <th key={b} style={{...TH,textAlign:'center'}}>{b}</th>)}
              <th style={{...TH,textAlign:'right'}}>
                {metric==='winrate' ? 'Win Rate' : metric==='expectancy' ? 'Expectancy' : 'Total P&L'}
              </th>
            </tr>
          </thead>
          <tbody>
            {symbols.map(sym => {
              const symTrades = trades.filter(t=>t.symbol===sym)
              const totalPnl  = symTrades.reduce((s,t)=>s+t.pnl,0)
              const totalWr   = symTrades.length ? symTrades.filter(t=>t.pnl>0).length/symTrades.length*100 : null
              const totalExp  = symTrades.length ? expectancy(symTrades) : null
              const aggVal    = metric==='winrate' ? totalWr : metric==='expectancy' ? totalExp : totalPnl
              const aggFmt    = metric==='winrate'
                ? (v => v!=null ? v.toFixed(1)+'%' : '—')
                : metric==='expectancy'
                ? (v => v!=null ? fU(v) : '—')
                : (v => fU(v))
              const aggColor  = aggVal==null ? 'var(--mu)'
                : metric==='total' ? (aggVal>=0?'#66ffa5':'#ff5258')
                : heatTextColor(metric==='winrate' ? aggVal-50 : aggVal)
              return (
                <tr key={sym}
                  onMouseEnter={e=>e.currentTarget.style.outline='1px solid var(--bd)'}
                  onMouseLeave={e=>e.currentTarget.style.outline='none'}>
                  <td style={{...TD,fontWeight:700,color:'var(--tx)'}}>{sym}</td>
                  {BUCKETS.map(b => {
                    const {val, count} = getVal(sym, b)
                    return <HeatmapCell key={b} val={val} count={count} fmt={fmt} />
                  })}
                  <td style={{...TD,textAlign:'right',fontWeight:700,color:aggColor}}>{aggFmt(aggVal)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function DowHeatmap({ trades }) {
  const [metric, setMetric] = useState('expectancy')

  const cells = useMemo(() => {
    const map = {}
    trades.forEach(t => {
      const dow = t.day_of_week
      const dir = t.direction
      if (!dow || !dir) return
      const k = `${dow}|${dir}`
      if (!map[k]) map[k] = []
      map[k].push(t)
    })
    return map
  }, [trades])

  const getVal = (dow, dir) => {
    const ts = cells[`${dow}|${dir}`] || []
    if (!ts.length) return { val: null, count: 0 }
    switch (metric) {
      case 'expectancy': return { val: expectancy(ts), count: ts.length }
      case 'winrate':    return { val: ts.filter(t=>t.pnl>0).length/ts.length*100, count: ts.length }
      case 'total':      return { val: ts.reduce((s,t)=>s+t.pnl,0), count: ts.length }
      default:           return { val: expectancy(ts), count: ts.length }
    }
  }

  const fmt = v => metric === 'winrate' ? v.toFixed(0)+'%' : fU(v)

  return (
    <Card>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16,flexWrap:'wrap',gap:8}}>
        <SectionHeader title="Day of Week × Direction Heatmap" sub="Where does directional edge cluster by day?" />
        <div style={{display:'flex',gap:6}}>
          {[['expectancy','Expectancy'],['winrate','Win Rate'],['total','Total P&L']].map(([v,l]) => (
            <button key={v} onClick={()=>setMetric(v)}
              style={{padding:'4px 10px',borderRadius:5,border:`1px solid ${metric===v?'var(--ac)':'var(--bd)'}`,
                background:metric===v?'var(--ac-bg)':'transparent',color:metric===v?'var(--ac2)':'var(--mu)',
                fontSize:11,cursor:'pointer',fontFamily:'var(--font-mono)',fontWeight:600}}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div style={{overflowX:'auto'}}>
        <table style={{borderCollapse:'collapse',width:'100%'}}>
          <thead>
            <tr>
              <th style={{...TH,textAlign:'left',minWidth:110}}>Day</th>
              <th style={{...TH,textAlign:'center'}}>Long</th>
              <th style={{...TH,textAlign:'center'}}>Short</th>
              <th style={{...TH,textAlign:'center'}}>Combined</th>
            </tr>
          </thead>
          <tbody>
            {DOW_ORDER.map(dow => {
              const l = getVal(dow, 'Long')
              const s = getVal(dow, 'Short')
              const all = trades.filter(t=>t.day_of_week===dow)
              const comb = all.length ? { val: metric==='total' ? all.reduce((s,t)=>s+t.pnl,0) : expectancy(all), count: all.length } : { val: null, count: 0 }
              return (
                <tr key={dow}
                  onMouseEnter={e=>e.currentTarget.style.background='var(--sf2)'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <td style={{...TD,fontWeight:700,color:'var(--tx)'}}>{dow.slice(0,3)}</td>
                  <HeatmapCell val={l.val} count={l.count} fmt={fmt} />
                  <HeatmapCell val={s.val} count={s.count} fmt={fmt} />
                  <HeatmapCell val={comb.val} count={comb.count} fmt={fmt} />
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// TAB 4: Where My Edge Lives (ranked combos)
// ────────────────────────────────────────────────────────────────────────────
function WhereMyEdgeLives({ trades }) {
  const [sortKey,  setSortKey]  = useState('expectancy')
  const [sortDir,  setSortDir]  = useState(-1)
  const [minTrades, setMinTrades] = useState(10)

  const combos = useMemo(() => {
    const map = {}
    trades.forEach(t => {
      const b   = bucketLabel(t.duration_mins)
      const key = `${t.symbol}|${t.direction}|${b}`
      if (!map[key]) map[key] = []
      map[key].push(t)
    })
    return Object.entries(map)
      .filter(([,ts]) => ts.length >= minTrades)
      .map(([key, ts]) => {
        const [symbol, direction, duration] = key.split('|')
        const wins   = ts.filter(t=>t.pnl>0)
        const losses = ts.filter(t=>t.pnl<0)
        const wr     = wins.length / ts.length
        const avgW   = wins.length   ? wins.reduce((s,t)=>s+t.pnl,0)/wins.length   : 0
        const avgL   = losses.length ? losses.reduce((s,t)=>s+t.pnl,0)/losses.length : 0
        const exp    = expectancy(ts)
        const pf     = profitFactor(ts)
        const total  = ts.reduce((s,t)=>s+t.pnl,0)
        return { symbol, direction, duration, trades:ts.length, wr, avgW, avgL, pf, expectancy:exp, total }
      })
  }, [trades, minTrades])

  const sorted = useMemo(() =>
    [...combos].sort((a,b) => sortDir * (a[sortKey] - b[sortKey])),
  [combos, sortKey, sortDir])

  const toggleSort = col => {
    if (sortKey === col) setSortDir(d=>d*-1)
    else { setSortKey(col); setSortDir(-1) }
  }

  const positive = sorted.filter(r=>r.expectancy>=0)
  const negative = sorted.filter(r=>r.expectancy<0).reverse()

  const COLS = [
    ['','Symbol+Dir+Duration',false],
    ['trades','Trades',false],
    ['wr','Win Rate',false],
    ['avgW','Avg Win',false],
    ['avgL','Avg Loss',false],
    ['pf','Prof. Factor',false],
    ['expectancy','Expectancy',false],
    ['total','Total P&L',false],
  ]

  const Row = ({r, rank, positive}) => (
    <tr onMouseEnter={e=>e.currentTarget.style.background='var(--sf2)'}
        onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
      <td style={{...TD,fontFamily:'var(--font-mono)',fontSize:9,color:'var(--mu)',textAlign:'center',width:28}}>{rank}</td>
      <td style={{...TD,minWidth:220}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontWeight:700,color:'var(--tx)',fontSize:12}}>{r.symbol}</span>
          <span style={{fontSize:9,fontWeight:700,padding:'1px 5px',borderRadius:3,
            color:r.direction==='Long'?'#00b5a3':'#ffb300',
            background:r.direction==='Long'?'rgba(0,181,163,.1)':'rgba(255,179,0,.1)',
            border:`1px solid ${r.direction==='Long'?'#00b5a3':'#ffb300'}`}}>
            {r.direction==='Long'?'▲':'▼'} {r.direction}
          </span>
          <span style={{fontSize:9,color:'var(--mu)',fontFamily:'var(--font-mono)',
            padding:'1px 5px',borderRadius:3,border:'1px solid var(--bd2)'}}>{r.duration}</span>
        </div>
      </td>
      <td style={{...TD,textAlign:'right',color:'var(--mu)'}}>{r.trades}</td>
      <td style={{...TD,textAlign:'right',color:r.wr>=.5?'#66ffa5':'#ff5258'}}>{fP(r.wr)}</td>
      <td style={{...TD,textAlign:'right',color:'#66ffa5'}}>{fU(r.avgW)}</td>
      <td style={{...TD,textAlign:'right',color:'#ff5258'}}>{fU(r.avgL)}</td>
      <td style={{...TD,textAlign:'right',color:r.pf>=1?'#66ffa5':'#ff5258'}}>{r.pf===Infinity?'∞':fN(r.pf)}</td>
      <td style={{...TD,textAlign:'right',fontWeight:700,fontSize:12,color:heatTextColor(r.expectancy)}}>{fU(r.expectancy)}</td>
      <td style={{...TD,textAlign:'right',fontWeight:600,color:r.total>=0?'#66ffa5':'#ff5258'}}>{fU(r.total)}</td>
    </tr>
  )

  return (
    <div style={{display:'grid',gap:16}}>
      {/* Controls */}
      <Card style={{padding:'14px 20px'}}>
        <div style={{display:'flex',alignItems:'center',gap:16,flexWrap:'wrap'}}>
          <div style={{fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>
            Min trades to show:
          </div>
          {[5,10,20,30].map(n => (
            <button key={n} onClick={()=>setMinTrades(n)}
              style={{padding:'3px 10px',borderRadius:4,border:`1px solid ${minTrades===n?'var(--ac)':'var(--bd)'}`,
                background:minTrades===n?'var(--ac-bg)':'transparent',color:minTrades===n?'var(--ac2)':'var(--mu)',
                fontSize:11,cursor:'pointer',fontFamily:'var(--font-mono)',fontWeight:600}}>
              {n}+
            </button>
          ))}
          <div style={{marginLeft:'auto',fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>
            <span style={{color:'#66ffa5',fontWeight:700}}>{positive.length}</span> positive ·
            <span style={{color:'#ff5258',fontWeight:700,marginLeft:6}}>{negative.length}</span> negative combinations
          </div>
        </div>
      </Card>

      {/* Positive expectancy table */}
      <Card>
        <SectionHeader
          title="✅ Scale These — Positive Expectancy Combinations"
          sub="Ranked by expectancy. These are the behaviours worth repeating and sizing up." />
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead>
              <tr>
                <th style={{...TH,width:28}}>#</th>
                <th style={{...TH,textAlign:'left'}}>Setup</th>
                {['trades','wr','avgW','avgL','pf','expectancy','total'].map(k => (
                  <th key={k} style={{...TH,textAlign:'right',cursor:'pointer'}} onClick={()=>toggleSort(k)}>
                    {k==='wr'?'Win Rate':k==='avgW'?'Avg Win':k==='avgL'?'Avg Loss':k==='pf'?'Prof. Factor':k==='expectancy'?'Expectancy':k==='total'?'Total P&L':'Trades'}
                    {' '}<SortInd col={k} sortKey={sortKey} sortDir={sortDir} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {positive.map((r,i) => <Row key={`${r.symbol}${r.direction}${r.duration}`} r={r} rank={i+1} positive />)}
              {positive.length === 0 && (
                <tr><td colSpan={9} style={{...TD,textAlign:'center',color:'var(--mu)',padding:24}}>
                  No combinations meet the minimum trade threshold.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Negative expectancy table */}
      {negative.length > 0 && (
        <Card>
          <SectionHeader
            title="❌ Eliminate These — Negative Expectancy Combinations"
            sub="Ranked by how much they're costing you. Consider removing these from your playbook." />
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr>
                  <th style={{...TH,width:28}}>#</th>
                  <th style={{...TH,textAlign:'left'}}>Setup</th>
                  {['trades','wr','avgW','avgL','pf','expectancy','total'].map(k => (
                    <th key={k} style={{...TH,textAlign:'right'}}>{k==='wr'?'Win Rate':k==='avgW'?'Avg Win':k==='avgL'?'Avg Loss':k==='pf'?'Prof. Factor':k==='expectancy'?'Expectancy':k==='total'?'Total P&L':'Trades'}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {negative.map((r,i) => <Row key={`${r.symbol}${r.direction}${r.duration}`} r={r} rank={i+1} positive={false} />)}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// TAB 5: Performance Improvement Simulator
// ────────────────────────────────────────────────────────────────────────────
function PerformanceSimulator({ trades }) {
  const [scenario, setScenario]     = useState('worst_symbol')
  const [customSym, setCustomSym]   = useState('')
  const [customDur, setCustomDur]   = useState('>24h')
  const [customPct, setCustomPct]   = useState(10)

  const baseline = useMemo(() => ({
    pnl: trades.reduce((s,t)=>s+t.pnl,0),
    trades: trades.length,
    wr: trades.length ? trades.filter(t=>t.pnl>0).length/trades.length : 0,
    exp: expectancy(trades),
    pf: profitFactor(trades),
  }), [trades])

  // Find worst symbol
  const worstSymbol = useMemo(() => {
    const bySymbol = {}
    trades.forEach(t => { if(!bySymbol[t.symbol]) bySymbol[t.symbol]=[]; bySymbol[t.symbol].push(t) })
    return Object.entries(bySymbol)
      .map(([sym,ts]) => [sym, ts.reduce((s,t)=>s+t.pnl,0)])
      .sort((a,b)=>a[1]-b[1])[0]?.[0] || ''
  }, [trades])

  const allSymbols = useMemo(() => {
    const bySymbol = {}
    trades.forEach(t => { if(!bySymbol[t.symbol]) bySymbol[t.symbol]=[]; bySymbol[t.symbol].push(t) })
    return Object.entries(bySymbol)
      .map(([sym,ts]) => [sym, ts.reduce((s,t)=>s+t.pnl,0)])
      .sort((a,b)=>a[1]-b[1])
  }, [trades])

  const simulate = useMemo(() => {
    let kept = trades
    let description = ''
    switch (scenario) {
      case 'worst_symbol':
        kept = trades.filter(t=>t.symbol !== worstSymbol)
        description = `Remove ${worstSymbol} (worst symbol by P&L)`
        break
      case 'custom_symbol':
        kept = trades.filter(t=>t.symbol !== customSym)
        description = `Remove ${customSym||'(select symbol)'}`
        break
      case 'worst_10pct': {
        const sorted = [...trades].sort((a,b)=>a.pnl-b.pnl)
        const cutoff = Math.floor(sorted.length * customPct/100)
        const worstSet = new Set(sorted.slice(0, cutoff).map((_,i)=>i))
        kept = sorted.slice(cutoff)
        description = `Remove worst ${customPct}% of trades (${cutoff} trades)`
        break
      }
      case 'remove_duration':
        kept = trades.filter(t=>bucketLabel(t.duration_mins) !== customDur)
        description = `Remove all ${customDur} trades`
        break
      case 'top_expectancy': {
        // Keep only top 50% expectancy symbol+dir+bucket combos
        const map = {}
        trades.forEach(t => {
          const k = `${t.symbol}|${t.direction}|${bucketLabel(t.duration_mins)}`
          if(!map[k]) map[k]=[]
          map[k].push(t)
        })
        const ranked = Object.entries(map)
          .filter(([,ts])=>ts.length>=10)
          .map(([k,ts])=>({ k, exp:expectancy(ts) }))
          .sort((a,b)=>b.exp-a.exp)
        const topKeys = new Set(ranked.slice(0, Math.ceil(ranked.length/2)).map(x=>x.k))
        kept = trades.filter(t => topKeys.has(`${t.symbol}|${t.direction}|${bucketLabel(t.duration_mins)}`))
        description = `Trade only top 50% expectancy setups (≥10 trades)`
        break
      }
      default: kept = trades
    }

    return {
      description,
      removed: trades.length - kept.length,
      pnl: kept.reduce((s,t)=>s+t.pnl,0),
      trades: kept.length,
      wr: kept.length ? kept.filter(t=>t.pnl>0).length/kept.length : 0,
      exp: expectancy(kept),
      pf: profitFactor(kept),
    }
  }, [trades, scenario, worstSymbol, customSym, customDur, customPct])

  const diff = simulate.pnl - baseline.pnl
  const pctImprovement = baseline.pnl !== 0 ? (diff/Math.abs(baseline.pnl))*100 : 0

  const MetricRow = ({label, base, sim, fmt=fU, higher=true}) => {
    const better = higher ? sim >= base : sim <= base
    return (
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,padding:'10px 0',borderBottom:'1px solid var(--bd2)'}}>
        <div style={{fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>{label}</div>
        <div style={{fontSize:12,fontFamily:'var(--font-mono)',fontWeight:600,color:'var(--tx)',textAlign:'right'}}>{fmt(base)}</div>
        <div style={{fontSize:12,fontFamily:'var(--font-mono)',fontWeight:700,color:better?'#66ffa5':'#ff5258',textAlign:'right'}}>
          {fmt(sim)} {sim!==base && <span style={{fontSize:9,opacity:.7}}>{better?'↑':'↓'}</span>}
        </div>
      </div>
    )
  }

  return (
    <Card>
      <SectionHeader title="Performance Improvement Simulator" sub="Quantify the impact of changing behaviour before risking capital" />

      {/* Scenario picker */}
      <div style={{display:'grid',gap:8,marginBottom:20}}>
        {[
          ['worst_symbol',   `Remove worst symbol (${worstSymbol})`],
          ['custom_symbol',  'Remove a specific symbol'],
          ['worst_10pct',    'Remove worst N% of trades'],
          ['remove_duration','Remove a duration bucket'],
          ['top_expectancy', 'Trade only top expectancy setups'],
        ].map(([id, label]) => (
          <label key={id} style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer',
            padding:'10px 14px',borderRadius:7,border:`1px solid ${scenario===id?'var(--ac)':'var(--bd)'}`,
            background:scenario===id?'var(--ac-bg)':'var(--sf2)',transition:'all .15s'}}>
            <input type="radio" checked={scenario===id} onChange={()=>setScenario(id)}
              style={{accentColor:'var(--ac)',width:14,height:14}} />
            <span style={{fontSize:12,color:scenario===id?'var(--ac2)':'var(--tx)',fontWeight:scenario===id?600:400}}>
              {label}
            </span>

            {/* Inline controls */}
            {scenario===id && id==='custom_symbol' && (
              <select value={customSym} onChange={e=>setCustomSym(e.target.value)} className="inp"
                style={{marginLeft:8,padding:'2px 8px',fontSize:11,fontFamily:'var(--font-mono)',flex:1,maxWidth:200}}>
                <option value=''>Select symbol…</option>
                {allSymbols.map(([sym,pnl])=>(
                  <option key={sym} value={sym}>{sym} ({fU(pnl)})</option>
                ))}
              </select>
            )}
            {scenario===id && id==='worst_10pct' && (
              <select value={customPct} onChange={e=>setCustomPct(+e.target.value)} className="inp"
                style={{marginLeft:8,padding:'2px 8px',fontSize:11,fontFamily:'var(--font-mono)'}}>
                {[5,10,15,20,25].map(n=><option key={n} value={n}>Worst {n}%</option>)}
              </select>
            )}
            {scenario===id && id==='remove_duration' && (
              <select value={customDur} onChange={e=>setCustomDur(e.target.value)} className="inp"
                style={{marginLeft:8,padding:'2px 8px',fontSize:11,fontFamily:'var(--font-mono)'}}>
                {BUCKETS.map(b=><option key={b} value={b}>{b}</option>)}
              </select>
            )}
          </label>
        ))}
      </div>

      {/* Results */}
      <div style={{background:'var(--sf2)',borderRadius:8,padding:16,border:'1px solid var(--bd)'}}>
        <div style={{marginBottom:12,fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>
          Scenario: <span style={{color:'var(--tx)',fontWeight:600}}>{simulate.description}</span>
          {simulate.removed > 0 && <span style={{color:'var(--bd2)',marginLeft:8}}>({simulate.removed} trades removed)</span>}
        </div>

        {/* Big number */}
        <div style={{display:'flex',alignItems:'baseline',gap:12,marginBottom:20,padding:'16px 0',borderBottom:'1px solid var(--bd)',flexWrap:'wrap'}}>
          <div style={{minWidth:0,flex:1}}>
            <div style={{fontSize:9,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.1em',fontFamily:'var(--font-mono)',marginBottom:4}}>P&L CHANGE</div>
            <div style={{fontSize:'clamp(18px,5vw,28px)',fontWeight:700,color:diff>=0?'#66ffa5':'#ff5258',fontFamily:'var(--font-mono)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
              {fU(diff)}
            </div>
          </div>
          <div style={{height:40,width:1,background:'var(--bd)',flexShrink:0}} />
          <div style={{minWidth:0,flex:1}}>
            <div style={{fontSize:9,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.1em',fontFamily:'var(--font-mono)',marginBottom:4}}>VS BASELINE</div>
            <div style={{fontSize:'clamp(18px,5vw,28px)',fontWeight:700,color:pctImprovement>=0?'#66ffa5':'#ff5258',fontFamily:'var(--font-mono)',whiteSpace:'nowrap'}}>
              {pctImprovement>=0?'+':''}{pctImprovement.toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Metric comparison */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:8}}>
          <div style={{fontSize:9,fontWeight:700,color:'var(--bd2)',textTransform:'uppercase',letterSpacing:'.1em',fontFamily:'var(--font-mono)'}}>METRIC</div>
          <div style={{fontSize:9,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.1em',fontFamily:'var(--font-mono)',textAlign:'right'}}>BASELINE</div>
          <div style={{fontSize:9,fontWeight:700,color:'var(--ac)',textTransform:'uppercase',letterSpacing:'.1em',fontFamily:'var(--font-mono)',textAlign:'right'}}>SIMULATED</div>
        </div>
        <MetricRow label="Total P&L"     base={baseline.pnl}    sim={simulate.pnl}    fmt={fU} />
        <MetricRow label="Trade Count"   base={baseline.trades} sim={simulate.trades} fmt={n=>n.toLocaleString()} />
        <MetricRow label="Win Rate"      base={baseline.wr}     sim={simulate.wr}     fmt={fP} />
        <MetricRow label="Expectancy"    base={baseline.exp}    sim={simulate.exp}    fmt={fU} />
        <MetricRow label="Profit Factor" base={baseline.pf}     sim={simulate.pf}     fmt={n=>n===Infinity?'∞':fN(n)} />
      </div>
    </Card>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ────────────────────────────────────────────────────────────────────────────
const SUB_TABS = [
  ['symbol',    '🎯 Symbol Edge'],
  ['duration',  '⏱ Duration Edge'],
  ['heatmaps',  '🌡 Heatmaps'],
  ['where',     '🔎 Where My Edge Lives'],
  ['simulator', '🧪 Simulator'],
  ['drawdown',  '📉 Drawdown'],
]

export default function EdgeDiscovery({ trades = [], stats = null }) {
  const [subTab, setSubTab] = useState('where')

  if (!trades.length) return (
    <div style={{padding:40,textAlign:'center',color:'var(--mu)',fontFamily:'var(--font-mono)',fontSize:12}}>
      No trades in current date range.
    </div>
  )

  return (
    <div style={{padding:'20px 24px',maxWidth:1400,margin:'0 auto'}}>
      {/* Sub-tab nav */}
      <div style={{display:'flex',gap:4,marginBottom:20,flexWrap:'wrap',borderBottom:'1px solid var(--bd)',paddingBottom:0}}>
        {SUB_TABS.map(([id, label]) => (
          <button key={id} onClick={()=>setSubTab(id)}
            style={{padding:'8px 16px',border:'none',borderBottom:`2px solid ${subTab===id?'var(--ac)':'transparent'}`,
              background:'transparent',color:subTab===id?'var(--ac2)':'var(--mu)',fontSize:12,fontWeight:subTab===id?700:400,
              cursor:'pointer',transition:'all .15s',marginBottom:-1,whiteSpace:'nowrap'}}>
            {label}
          </button>
        ))}
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center',
          fontSize:10,color:'var(--mu)',fontFamily:'var(--font-mono)',paddingBottom:8}}>
          {trades.length.toLocaleString()} trades
        </div>
      </div>

      {subTab === 'symbol'    && <SymbolExpectancyTable   trades={trades} />}
      {subTab === 'duration'  && <DurationExpectancyTable trades={trades} />}
      {subTab === 'heatmaps'  && (
        <div style={{display:'grid',gap:20}}>
          <SymbolDurationHeatmap trades={trades} />
          <DowHeatmap            trades={trades} />
        </div>
      )}
      {subTab === 'where'     && <WhereMyEdgeLives        trades={trades} />}
      {subTab === 'simulator' && <PerformanceSimulator    trades={trades} />}
      {subTab === 'drawdown'  && <DrawdownAttribution    trades={trades} stats={stats} />}
    </div>
  )
}
