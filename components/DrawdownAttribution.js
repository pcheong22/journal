// components/DrawdownAttribution.js
// Drawdown Attribution sub-tab for the Edge Discovery tab
// Shows: drawdown timeline, top event attribution by symbol/direction, symbol drag table

import { useState, useMemo } from 'react'

const fU  = (n, d=0) => n == null ? '—' : (n>=0?'+':'') + n.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:d,maximumFractionDigits:d})
const fA  = n => n == null ? '—' : '$' + Math.abs(Math.round(n)).toLocaleString()
const fN  = (n,d=1) => n == null ? '—' : n.toFixed(d)

const TH = { fontSize:8, fontWeight:700, color:'var(--mu)', textTransform:'uppercase',
  letterSpacing:'.06em', fontFamily:'var(--font-mono)', padding:'5px 6px',
  borderBottom:'1px solid var(--bd)', whiteSpace:'nowrap' }
const TD = { fontSize:10, fontFamily:'var(--font-mono)', padding:'5px 6px',
  borderBottom:'1px solid var(--bd2)', whiteSpace:'nowrap' }

function Card({ children, style }) {
  return (
    <div style={{background:'var(--sf)',border:'1px solid var(--bd)',borderRadius:10,padding:'14px 12px',overflow:'visible',...style}}>
      {children}
    </div>
  )
}

function SectionHeader({ title, sub }) {
  return (
    <div style={{marginBottom:14}}>
      <div style={{fontSize:12,fontWeight:700,color:'var(--tx)'}}>{title}</div>
      {sub && <div style={{fontSize:11,color:'var(--mu)',marginTop:3}}>{sub}</div>}
    </div>
  )
}

// Depth bar — red fill proportional to drawdown depth
function DepthBar({ depth, maxDepth }) {
  const pct = maxDepth > 0 ? Math.min(100, (depth / maxDepth) * 100) : 0
  return (
    <div style={{display:'flex',alignItems:'center',gap:4}}>
      <div style={{flex:1,height:4,background:'var(--sf2)',borderRadius:3,overflow:'hidden',minWidth:40}}>
        <div style={{height:'100%',width:`${pct}%`,background:'#ff5258',borderRadius:3,transition:'width .3s'}} />
      </div>
      <span style={{fontSize:10,fontWeight:600,color:'#ff5258',fontFamily:'var(--font-mono)',minWidth:65,textAlign:'right'}}>
        -{fA(depth)}
      </span>
    </div>
  )
}

// ── SECTION 1: Drawdown Timeline ──────────────────────────────────────────────
function DrawdownTimeline({ events }) {
  const [selected, setSelected] = useState(null)
  const top = events.slice(0, 10)
  const maxDepth = top.length ? top[0].depth : 1

  if (!events.length) return (
    <Card><div style={{color:'var(--mu)',fontSize:12,textAlign:'center',padding:20}}>No drawdown events detected.</div></Card>
  )

  return (
    <Card>
      <SectionHeader
        title="Drawdown Events"
        sub="All distinct peak-to-trough periods, ranked by severity. Click a row to see details." />
      <div style={{overflowX:'auto',WebkitOverflowScrolling:'touch',margin:'0 -12px',padding:'0 12px'}}>
        <table style={{borderCollapse:'collapse',minWidth:520}}>
          <thead>
            <tr>
              {['#','Peak Date','Trough Date','Recovery','Depth','Duration','Recovery Time','Status'].map(h => (
                <th key={h} style={{...TH,textAlign:h==='#'?'center':'left'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {top.map((ev, i) => (
              <tr key={i}
                onClick={() => setSelected(selected === i ? null : i)}
                style={{cursor:'pointer',background:selected===i?'var(--ac-bg)':'transparent',transition:'background .1s'}}
                onMouseEnter={e=>e.currentTarget.style.background=selected===i?'var(--ac-bg)':'var(--sf2)'}
                onMouseLeave={e=>e.currentTarget.style.background=selected===i?'var(--ac-bg)':'transparent'}>
                <td style={{...TD,textAlign:'center',color:'var(--mu)',fontWeight:700}}>{i+1}</td>
                <td style={{...TD}}>{ev.peak_date || '—'}</td>
                <td style={{...TD,color:'#ff5258'}}>{ev.trough_date || '—'}</td>
                <td style={{...TD,color:ev.recovery_date?'#66ffa5':'#f0a500'}}>
                  {ev.recovery_date || <span style={{color:'#f0a500'}}>Open ⚠</span>}
                </td>
                <td style={{...TD,minWidth:180}}>
                  <DepthBar depth={ev.depth} maxDepth={maxDepth} />
                </td>
                <td style={{...TD,color:'var(--mu)'}}>{ev.duration_days != null ? `${ev.duration_days}d` : '—'}</td>
                <td style={{...TD,color:'var(--mu)'}}>{ev.recovery_days != null ? `${ev.recovery_days}d` : ev.recovery_date ? '0d' : '—'}</td>
                <td style={{...TD}}>
                  <span style={{fontSize:9,fontWeight:700,padding:'2px 6px',borderRadius:3,fontFamily:'var(--font-mono)',
                    background:ev.recovery_date?'rgba(102,255,165,.1)':'rgba(255,165,0,.1)',
                    color:ev.recovery_date?'#66ffa5':'#f0a500',
                    border:`1px solid ${ev.recovery_date?'rgba(102,255,165,.3)':'rgba(255,165,0,.3)'}`}}>
                    {ev.recovery_date ? 'Recovered' : 'Open'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary stats row */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(90px,1fr))',gap:6,marginTop:12,
        padding:'10px 0',borderTop:'1px solid var(--bd)'}}>
        {[
          ['Total Events',    events.length],
          ['Open Drawdowns',  events.filter(e=>!e.recovery_date).length],
          ['Avg Depth',       fA(events.reduce((s,e)=>s+e.depth,0)/events.length)],
          ['Avg Duration',    `${Math.round(events.filter(e=>e.duration_days!=null).reduce((s,e)=>s+(e.duration_days||0),0) / Math.max(1,events.filter(e=>e.duration_days!=null).length))}d`],
          ['Worst Drawdown',  fA(events[0]?.depth)],
          ['Longest Recovery', `${Math.max(...events.filter(e=>e.recovery_days!=null).map(e=>e.recovery_days),0)}d`],
        ].map(([label, val]) => (
          <div key={label}>
            <div style={{fontSize:9,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.07em',fontFamily:'var(--font-mono)',marginBottom:3}}>{label}</div>
            <div style={{fontSize:14,fontWeight:700,fontFamily:'var(--font-mono)',color:'var(--tx)'}}>{val}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── SECTION 2: Top Drawdown Attribution ──────────────────────────────────────
function DrawdownAttrib({ trades, events }) {
  const [selectedEvent, setSelectedEvent] = useState(0)
  const top3 = events.slice(0, 3)

  const attribution = useMemo(() => {
    if (!top3.length || selectedEvent >= top3.length) return []
    const ev = top3[selectedEvent]
    if (!ev.peak_date || !ev.trough_date) return []

    const inWindow = trades.filter(t => {
      const ts = (t.exit_time || t.entry_time || '').slice(0, 10)
      return ts >= ev.peak_date && ts <= ev.trough_date
    })

    if (!inWindow.length) return []

    // Group by symbol + direction
    const map = {}
    inWindow.forEach(t => {
      const key = `${t.symbol}|${t.direction}`
      if (!map[key]) map[key] = { symbol: t.symbol, direction: t.direction, trades: 0, pnl: 0 }
      map[key].trades++
      map[key].pnl += t.pnl
    })

    return Object.values(map)
      .sort((a, b) => a.pnl - b.pnl) // worst first
      .slice(0, 15)
  }, [trades, events, selectedEvent])

  if (!top3.length) return null

  const ev = top3[selectedEvent]
  const totalWindowPnl = attribution.reduce((s, r) => s + r.pnl, 0)

  return (
    <Card>
      <SectionHeader
        title="Drawdown Attribution"
        sub="Which symbols and directions caused each major drawdown?" />

      {/* Event selector */}
      <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap'}}>
        {top3.map((e, i) => (
          <button key={i} onClick={() => setSelectedEvent(i)}
            style={{padding:'5px 10px',borderRadius:6,fontSize:10,fontFamily:'var(--font-mono)',
              border:`1px solid ${selectedEvent===i?'#ff5258':'var(--bd)'}`,
              background:selectedEvent===i?'rgba(255,82,88,.1)':'var(--sf2)',
              color:selectedEvent===i?'#ff5258':'var(--mu)',cursor:'pointer',fontWeight:selectedEvent===i?700:400}}>
            #{i+1} -{fA(e.depth)} {e.peak_date?.slice(0,7)}
          </button>
        ))}
      </div>

      {/* Event summary */}
      <div style={{background:'rgba(255,82,88,.05)',border:'1px solid rgba(255,82,88,.2)',borderRadius:8,
        padding:'8px 10px',marginBottom:12,display:'grid',
        gridTemplateColumns:'repeat(auto-fit,minmax(90px,1fr))',gap:8}}>
        {[
          ['Peak Date',    ev.peak_date || '—'],
          ['Trough Date',  ev.trough_date || '—'],
          ['Depth',        fA(ev.depth)],
          ['Duration',     ev.duration_days != null ? `${ev.duration_days} days` : '—'],
          ['Recovery',     ev.recovery_date || 'Still open'],
          ['Recovery Time',ev.recovery_days != null ? `${ev.recovery_days} days` : '—'],
        ].map(([l,v]) => (
          <div key={l}>
            <div style={{fontSize:9,fontWeight:700,color:'#ff5258',opacity:.7,textTransform:'uppercase',letterSpacing:'.07em',fontFamily:'var(--font-mono)',marginBottom:2}}>{l}</div>
            <div style={{fontSize:12,fontWeight:600,fontFamily:'var(--font-mono)',color:'var(--tx)'}}>{v}</div>
          </div>
        ))}
      </div>

      {/* Attribution table */}
      {attribution.length > 0 ? (
        <div style={{overflowX:'auto',WebkitOverflowScrolling:'touch',margin:'0 -12px',padding:'0 12px'}}>
          <table style={{borderCollapse:'collapse',minWidth:400}}>
            <thead>
              <tr>
                {['Symbol','Dir','Trades','P&L in Period','% of Drawdown'].map(h => (
                  <th key={h} style={{...TH,textAlign:h==='Symbol'||h==='Dir'?'left':'right'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attribution.map((r, i) => {
                const pct = totalWindowPnl !== 0 ? (r.pnl / Math.abs(totalWindowPnl)) * 100 : 0
                return (
                  <tr key={i}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--sf2)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <td style={{...TD,fontWeight:700,color:'var(--tx)'}}>{r.symbol}</td>
                    <td style={{...TD}}>
                      <span style={{fontSize:9,fontWeight:700,padding:'1px 5px',borderRadius:3,
                        color:r.direction==='Long'?'#00b5a3':'#ffb300',
                        background:r.direction==='Long'?'rgba(0,181,163,.1)':'rgba(255,179,0,.1)',
                        border:`1px solid ${r.direction==='Long'?'#00b5a3':'#ffb300'}`}}>
                        {r.direction==='Long'?'▲':'▼'} {r.direction}
                      </span>
                    </td>
                    <td style={{...TD,textAlign:'right',color:'var(--mu)'}}>{r.trades}</td>
                    <td style={{...TD,textAlign:'right',fontWeight:600,color:r.pnl>=0?'#66ffa5':'#ff5258'}}>
                      {fU(r.pnl)}
                    </td>
                    <td style={{...TD,textAlign:'right'}}>
                      <div style={{display:'flex',alignItems:'center',gap:6,justifyContent:'flex-end'}}>
                        <div style={{width:50,height:4,background:'var(--sf2)',borderRadius:2,overflow:'hidden'}}>
                          <div style={{height:'100%',width:`${Math.min(100,Math.abs(pct))}%`,
                            background:r.pnl<0?'#ff5258':'#66ffa5',borderRadius:2}} />
                        </div>
                        <span style={{color:r.pnl<0?'#ff5258':'#66ffa5',minWidth:40,textAlign:'right'}}>
                          {pct.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{color:'var(--mu)',fontSize:11,textAlign:'center',padding:16}}>
          No trades found in this drawdown window.
        </div>
      )}
    </Card>
  )
}

// ── SECTION 3: Symbol Drag Table ─────────────────────────────────────────────
// Ranks symbols by how much drawdown damage they caused vs their total P&L
function SymbolDragTable({ trades }) {
  const [sortKey, setSortKey] = useState('max_dd')
  const [sortDir, setSortDir] = useState(-1)

  const rows = useMemo(() => {
    const bySymbol = {}
    trades.forEach(t => {
      if (!bySymbol[t.symbol]) bySymbol[t.symbol] = []
      bySymbol[t.symbol].push(t)
    })

    return Object.entries(bySymbol).map(([symbol, ts]) => {
      const sorted = [...ts].sort((a,b) => {
        const ta = a.exit_time || a.entry_time || ''
        const tb = b.exit_time || b.entry_time || ''
        return ta.localeCompare(tb)
      })

      // Compute per-symbol max drawdown
      let cum = 0, peak = 0, maxDD = 0
      sorted.forEach(t => {
        cum += t.pnl
        if (cum > peak) peak = cum
        const dd = peak - cum
        if (dd > maxDD) maxDD = dd
      })

      const totalPnl  = ts.reduce((s,t) => s + t.pnl, 0)
      const lossTrades = ts.filter(t => t.pnl < 0)
      const grossLoss  = lossTrades.reduce((s,t) => s + t.pnl, 0)

      return {
        symbol,
        trades:   ts.length,
        total_pnl: totalPnl,
        max_dd:   maxDD,
        gross_loss: grossLoss,
        // Drag score: max drawdown relative to total P&L
        // High score = causes lots of drawdown relative to what it makes
        drag_score: totalPnl > 0 ? maxDD / totalPnl : (maxDD > 0 ? 99 : 0),
      }
    }).filter(r => r.max_dd > 0)
  }, [trades])

  const sorted = useMemo(() =>
    [...rows].sort((a, b) => sortDir * (a[sortKey] - b[sortKey])),
  [rows, sortKey, sortDir])

  const toggleSort = col => {
    if (sortKey === col) setSortDir(d => d * -1)
    else { setSortKey(col); setSortDir(-1) }
  }

  const SortInd = ({ col }) => sortKey !== col
    ? <span style={{opacity:.3}}>⇅</span>
    : <span style={{color:'var(--ac)'}}>{sortDir===1?'↑':'↓'}</span>

  const maxDd = rows.length ? Math.max(...rows.map(r => r.max_dd)) : 1

  return (
    <Card>
      <SectionHeader
        title="Symbol Drag Analysis"
        sub="Which instruments cause the most drawdown damage? Drag Score = max drawdown ÷ total P&L. High score = consider reducing." />
      <div style={{overflowX:'auto',WebkitOverflowScrolling:'touch',margin:'0 -12px',padding:'0 12px'}}>
        <table style={{borderCollapse:'collapse',minWidth:360}}>
          <thead>
            <tr>
              {[
                ['symbol','Symbol'],['trades','Trades'],['total_pnl','P&L'],
                ['max_dd','Max DD'],['drag_score','Drag ↓'],
              ].map(([key,label]) => (
                <th key={key} style={{...TH,textAlign:key==='symbol'?'left':'right',cursor:'pointer'}}
                  onClick={() => toggleSort(key)}>
                  {label} <SortInd col={key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.symbol}
                onMouseEnter={e=>e.currentTarget.style.background='var(--sf2)'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <td style={{...TD,fontWeight:700,color:'var(--tx)'}}>{r.symbol}</td>
                <td style={{...TD,textAlign:'right',color:'var(--mu)'}}>{r.trades}</td>
                <td style={{...TD,textAlign:'right',fontWeight:600,color:r.total_pnl>=0?'#66ffa5':'#ff5258'}}>
                  {fU(r.total_pnl)}
                </td>
                <td style={{...TD,textAlign:'right',minWidth:120}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,justifyContent:'flex-end'}}>
                    <div style={{width:60,height:5,background:'var(--sf2)',borderRadius:3,overflow:'hidden'}}>
                      <div style={{height:'100%',width:`${Math.round(r.max_dd/maxDd*100)}%`,
                        background:'#ff5258',borderRadius:3}} />
                    </div>
                    <span style={{color:'#ff5258',fontWeight:600}}>{fA(r.max_dd)}</span>
                  </div>
                </td>
                <td style={{...TD,textAlign:'right'}}>
                  <span style={{fontWeight:700,fontSize:12,fontFamily:'var(--font-mono)',
                    color: r.drag_score >= 2 ? '#ff5258' : r.drag_score >= 1 ? '#f0a500' : '#66ffa5'}}>
                    {r.drag_score >= 99 ? '∞' : r.drag_score.toFixed(2)}
                    {r.drag_score >= 2 && <span style={{fontSize:9,marginLeft:3}}>⚠</span>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{marginTop:10,fontSize:9,color:'var(--mu)',lineHeight:1.5,borderTop:'1px solid var(--bd)',paddingTop:8}}>
        <strong style={{color:'var(--tx)'}}>Drag Score guide:</strong> &lt;1.0 = drawdown is smaller than total profit (healthy) · 1-2 = drawdown approaches profit (monitor) · &gt;2 ⚠ = drawdown exceeds profit (reduce or remove)
      </div>
    </Card>
  )
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────
export default function DrawdownAttribution({ trades = [], stats = null }) {
  const events = stats?.drawdown_events || []

  if (!trades.length) return (
    <div style={{padding:40,textAlign:'center',color:'var(--mu)',fontFamily:'var(--font-mono)',fontSize:12}}>
      No trades in current date range.
    </div>
  )

  return (
    <div style={{padding:'0 4px',maxWidth:1400,margin:'0 auto',display:'grid',gap:12}}>
      <DrawdownTimeline events={events} />
      {events.length >= 1 && <DrawdownAttrib trades={trades} events={events} />}
      <SymbolDragTable trades={trades} />
    </div>
  )
}
