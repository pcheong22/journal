// components/EdgeConcentration.js
// Answers: where does my edge actually come from, and how concentrated is it?
// Three sections:
//   1. Pareto Analysis — top X% of trades = Y% of profits
//   2. Profit Concentration Table — by symbol/direction/duration
//   3. Tail Cost Analysis — what the worst X% is costing you

import { useState, useMemo } from 'react'

// ── Helpers ───────────────────────────────────────────────────────────────────
const fU  = (n, d=0) => n == null ? '—' : (n>=0?'+':'') + n.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:d,maximumFractionDigits:d})
const fA  = n => '$' + Math.abs(Math.round(n)).toLocaleString()
const fP  = (n,d=1) => (n*100).toFixed(d)+'%'
const fN  = (n,d=1) => n.toFixed(d)

const TH = { fontSize:9, fontWeight:700, color:'var(--mu)', textTransform:'uppercase',
  letterSpacing:'.07em', fontFamily:'var(--font-mono)', padding:'6px 8px',
  borderBottom:'1px solid var(--bd)', whiteSpace:'nowrap', cursor:'pointer', userSelect:'none' }
const TD = { fontSize:11, fontFamily:'var(--font-mono)', padding:'6px 8px',
  borderBottom:'1px solid var(--bd2)', whiteSpace:'nowrap' }

function Card({ children, style }) {
  return (
    <div style={{background:'var(--sf)',border:'1px solid var(--bd)',borderRadius:10,
      padding:'14px 12px',overflow:'hidden',...style}}>
      {children}
    </div>
  )
}

function SectionHeader({ title, sub }) {
  return (
    <div style={{marginBottom:14}}>
      <div style={{fontSize:12,fontWeight:700,color:'var(--tx)'}}>{title}</div>
      {sub && <div style={{fontSize:11,color:'var(--mu)',marginTop:3,lineHeight:1.4}}>{sub}</div>}
    </div>
  )
}

// ── SECTION 1: Pareto Analysis ────────────────────────────────────────────────
function ParetoAnalysis({ trades }) {
  const [threshold, setThreshold] = useState(20) // % of trades

  const sorted = useMemo(() =>
    [...trades].filter(t => t.pnl != null).sort((a,b) => b.pnl - a.pnl),
  [trades])

  const totalGrossProfit = useMemo(() =>
    sorted.filter(t => t.pnl > 0).reduce((s,t) => s+t.pnl, 0),
  [sorted])

  const totalNetPnl = useMemo(() =>
    sorted.reduce((s,t) => s+t.pnl, 0),
  [sorted])

  // Build cumulative data for the chart bars
  const paretoData = useMemo(() => {
    const pcts = [1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80]
    return pcts.map(pct => {
      const n = Math.max(1, Math.round(sorted.length * pct / 100))
      const topN = sorted.slice(0, n)
      const grossP = topN.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0)
      const netP   = topN.reduce((s,t)=>s+t.pnl,0)
      const grossPct = totalGrossProfit > 0 ? grossP/totalGrossProfit*100 : 0
      const netPct   = totalNetPnl > 0 ? netP/totalNetPnl*100 : 0
      return { pct, n, grossP, netP, grossPct, netPct }
    })
  }, [sorted, totalGrossProfit, totalNetPnl])

  // Specific threshold stats
  const thresholdStats = useMemo(() => {
    const n = Math.max(1, Math.round(sorted.length * threshold / 100))
    const topN = sorted.slice(0, n)
    const grossP = topN.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0)
    const netP   = topN.reduce((s,t)=>s+t.pnl,0)
    return {
      n,
      grossP,
      netP,
      grossPct: totalGrossProfit > 0 ? grossP/totalGrossProfit*100 : 0,
      netPct:   totalNetPnl > 0 ? netP/totalNetPnl*100 : 0,
      avgPnl:   topN.length ? netP/topN.length : 0,
    }
  }, [sorted, threshold, totalGrossProfit, totalNetPnl])

  const maxGrossPct = Math.max(...paretoData.map(d=>d.grossPct), 1)

  return (
    <Card>
      <SectionHeader
        title="Pareto Analysis"
        sub="How concentrated is your profitability? Green = gross profit from winners only. Blue = net P&L including losses in the selection. They diverge when top trades include some losers." />

      {/* Summary callout */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:16}}>
        <div style={{background:'rgba(102,255,165,.06)',border:'1px solid rgba(102,255,165,.2)',
          borderRadius:8,padding:'10px 12px'}}>
          <div style={{fontSize:9,fontWeight:700,color:'#66ffa5',textTransform:'uppercase',
            letterSpacing:'.07em',fontFamily:'var(--font-mono)',marginBottom:4}}>Top 10% of trades</div>
          <div style={{fontSize:18,fontWeight:700,fontFamily:'var(--font-mono)',color:'#66ffa5'}}>
            {paretoData.find(d=>d.pct===10)?.grossPct.toFixed(0)}%
          </div>
          <div style={{fontSize:10,color:'var(--mu)',marginTop:2}}>of gross profit</div>
        </div>
        <div style={{background:'rgba(102,255,165,.06)',border:'1px solid rgba(102,255,165,.2)',
          borderRadius:8,padding:'10px 12px'}}>
          <div style={{fontSize:9,fontWeight:700,color:'#66ffa5',textTransform:'uppercase',
            letterSpacing:'.07em',fontFamily:'var(--font-mono)',marginBottom:4}}>Top 20% of trades</div>
          <div style={{fontSize:18,fontWeight:700,fontFamily:'var(--font-mono)',color:'#66ffa5'}}>
            {paretoData.find(d=>d.pct===20)?.grossPct.toFixed(0)}%
          </div>
          <div style={{fontSize:10,color:'var(--mu)',marginTop:2}}>of gross profit</div>
        </div>
      </div>

      {/* Interactive threshold slider */}
      <div style={{background:'var(--sf2)',borderRadius:8,padding:'12px',marginBottom:16}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',fontFamily:'var(--font-mono)',
            textTransform:'uppercase',letterSpacing:'.06em'}}>
            Top {threshold}% of trades ({thresholdStats.n} trades)
          </div>
          <input type="range" min={1} max={80} value={threshold}
            onChange={e=>setThreshold(+e.target.value)}
            style={{width:120,accentColor:'#66ffa5'}} />
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
          {[
            ['Gross Profit', fA(thresholdStats.grossP), `${thresholdStats.grossPct.toFixed(0)}% of total`],
            ['Net P&L',      fU(Math.round(thresholdStats.netP)), `${thresholdStats.netPct.toFixed(0)}% of total`],
            ['Avg per Trade',fU(Math.round(thresholdStats.avgPnl)), 'vs rest'],
          ].map(([label, val, sub]) => (
            <div key={label}>
              <div style={{fontSize:9,color:'var(--mu)',fontFamily:'var(--font-mono)',
                textTransform:'uppercase',letterSpacing:'.06em',marginBottom:2}}>{label}</div>
              <div style={{fontSize:13,fontWeight:700,fontFamily:'var(--font-mono)',
                color:'#66ffa5'}}>{val}</div>
              <div style={{fontSize:9,color:'var(--mu)',marginTop:1}}>{sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Bar chart — gross profit concentration */}
      <div style={{marginBottom:6}}>
        <div style={{fontSize:9,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',
          letterSpacing:'.07em',fontFamily:'var(--font-mono)',marginBottom:8}}>
          Gross profit concentration by trade % threshold
        </div>
        {paretoData.map(d => (
          <div key={d.pct} title={`Top ${d.pct}% (${d.n} trades): ${d.grossPct.toFixed(0)}% of gross profit | Net P&L ${d.netPct.toFixed(0)}% of total`} style={{display:'flex',alignItems:'center',gap:8,marginBottom:5,cursor:'default'}}>
            <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'var(--mu)',
              width:32,textAlign:'right',flexShrink:0}}>
              {d.pct}%
            </div>
            <div style={{flex:1,height:18,background:'var(--sf2)',borderRadius:3,overflow:'hidden',position:'relative'}}>
              {/* Gross profit bar — green, full height */}
              <div style={{position:'absolute',top:0,left:0,height:'100%',
                width:`${(d.grossPct/maxGrossPct)*100}%`,
                background:'rgba(102,255,165,.55)',borderRadius:3,transition:'width .4s'}} />
              {/* Net P&L bar — blue, slightly narrower */}
              <div style={{position:'absolute',top:3,left:0,height:12,
                width:`${Math.min(100,Math.max(0,(d.netPct/maxGrossPct)*100))}%`,
                background:'rgba(126,184,247,0.85)',borderRadius:2,transition:'width .4s'}} />
            </div>
            <div style={{fontSize:10,fontFamily:'var(--font-mono)',color:'#66ffa5',
              width:36,textAlign:'right',flexShrink:0,fontWeight:600}}>
              {d.grossPct.toFixed(0)}%
            </div>
          </div>
        ))}
        <div style={{fontSize:9,color:'var(--mu)',fontFamily:'var(--font-mono)',
          marginBottom:6,lineHeight:1.5}}>
          Green = gross profit (winners only). Blue = net P&L (all trades in selection).
          They diverge past your win rate % threshold. Hover bars for details.
        </div>
        <div style={{display:'flex',gap:16,marginTop:8}}>
          <div style={{display:'flex',alignItems:'center',gap:5,fontSize:9,color:'var(--mu)'}}>
            <div style={{width:12,height:6,background:'rgba(102,255,165,.4)',borderRadius:2}} />
            Gross profit %
          </div>
          <div style={{display:'flex',alignItems:'center',gap:5,fontSize:9,color:'var(--mu)'}}>
            <div style={{width:12,height:4,background:'#66ffa5',borderRadius:2}} />
            Net P&L %
          </div>
        </div>
      </div>
    </Card>
  )
}

// ── SECTION 2: Profit Concentration Table ─────────────────────────────────────
function ConcentrationTable({ trades }) {
  const [dimension, setDimension] = useState('symbol')
  const [metric,    setMetric]    = useState('net')
  const [sortDir,   setSortDir]   = useState(-1)

  const totalGross = useMemo(() =>
    trades.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0), [trades])
  const totalNet   = useMemo(() =>
    trades.reduce((s,t)=>s+t.pnl,0), [trades])

  function bucketLabel(d) {
    if (d == null) return 'Unknown'
    if (d < 5)    return '<5m'
    if (d < 15)   return '5-15m'
    if (d < 60)   return '15-60m'
    if (d < 240)  return '1-4h'
    if (d < 1440) return '4-24h'
    return '>24h'
  }

  const rows = useMemo(() => {
    const map = {}
    trades.forEach(t => {
      const key = dimension === 'symbol'    ? t.symbol
                : dimension === 'direction' ? t.direction
                : dimension === 'duration'  ? bucketLabel(t.duration_mins)
                : t.symbol  // fallback
      if (!key) return
      if (!map[key]) map[key] = { key, trades:0, wins:0, grossP:0, grossL:0, netP:0 }
      map[key].trades++
      if (t.pnl > 0) { map[key].wins++; map[key].grossP += t.pnl }
      if (t.pnl < 0) map[key].grossL += Math.abs(t.pnl)
      map[key].netP += t.pnl
    })

    return Object.values(map).map(r => ({
      ...r,
      wr:       r.wins / r.trades,
      pf:       r.grossL > 0 ? r.grossP/r.grossL : null,
      grossPct: totalGross > 0 ? r.grossP/totalGross*100 : 0,
      netPct:   totalNet  > 0 ? r.netP/totalNet*100   : 0,
    })).sort((a,b) => sortDir * (
      metric === 'net'   ? b.netP   - a.netP   :
      metric === 'gross' ? b.grossP - a.grossP :
      b.grossPct - a.grossPct
    ))
  }, [trades, dimension, metric, sortDir, totalGross, totalNet])

  // Cumulative
  const withCumulative = useMemo(() => {
    let cumGross = 0, cumNet = 0
    return rows.map(r => {
      cumGross += r.grossPct
      cumNet   += r.netPct
      return { ...r, cumGross, cumNet }
    })
  }, [rows])

  const maxGrossP = Math.max(...rows.map(r=>r.grossP), 1)

  return (
    <Card>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',
        marginBottom:14,flexWrap:'wrap',gap:8}}>
        <SectionHeader title="Profit Concentration" sub="Which segments generate disproportionate profit?" />
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {[['symbol','Symbol'],['direction','Direction'],['duration','Duration']].map(([v,l]) => (
            <button key={v} onClick={()=>setDimension(v)}
              style={{padding:'3px 10px',borderRadius:4,border:`1px solid ${dimension===v?'var(--ac)':'var(--bd)'}`,
                background:dimension===v?'var(--ac-bg)':'transparent',
                color:dimension===v?'var(--ac2)':'var(--mu)',
                fontSize:10,cursor:'pointer',fontFamily:'var(--font-mono)',fontWeight:600}}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Metric toggle */}
      <div style={{display:'flex',gap:6,marginBottom:12}}>
        {[['net','Net P&L'],['gross','Gross Profit']].map(([v,l]) => (
          <button key={v} onClick={()=>setMetric(v)}
            style={{padding:'3px 10px',borderRadius:4,border:`1px solid ${metric===v?'var(--ac)':'var(--bd)'}`,
              background:metric===v?'var(--ac-bg)':'transparent',
              color:metric===v?'var(--ac2)':'var(--mu)',
              fontSize:10,cursor:'pointer',fontFamily:'var(--font-mono)',fontWeight:600}}>
            {l}
          </button>
        ))}
      </div>

      <div style={{overflowX:'auto',WebkitOverflowScrolling:'touch'}}>
        <table style={{borderCollapse:'collapse',minWidth:420,width:'100%'}}>
          <thead>
            <tr>
              {[
                ['key',      dimension === 'symbol' ? 'Symbol' : dimension === 'direction' ? 'Direction' : 'Duration'],
                ['trades',   'Trades'],
                ['wr',       'WR'],
                ['grossP',   'Gross P'],
                ['netP',     'Net P&L'],
                ['grossPct', '% Gross'],
                ['cumGross', 'Cumul.'],
              ].map(([k,l]) => (
                <th key={k} style={{...TH,textAlign:k==='key'?'left':'right'}}
                  onClick={()=>{ if(k!=='cumGross'){setSortDir(d=>d*-1)} }}>
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {withCumulative.map((r,i) => (
              <tr key={r.key}
                onMouseEnter={e=>e.currentTarget.style.background='var(--sf2)'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <td style={{...TD,fontWeight:700,color:'var(--tx)'}}>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontSize:9,color:'var(--mu)',width:14,flexShrink:0,
                      fontFamily:'var(--font-mono)'}}>{i+1}</span>
                    {r.key}
                  </div>
                </td>
                <td style={{...TD,textAlign:'right',color:'var(--mu)'}}>{r.trades}</td>
                <td style={{...TD,textAlign:'right',color:r.wr>=.5?'#66ffa5':'#ff5258'}}>
                  {fP(r.wr,0)}
                </td>
                <td style={{...TD,textAlign:'right'}}>
                  <div style={{display:'flex',alignItems:'center',gap:5,justifyContent:'flex-end'}}>
                    <div style={{width:40,height:4,background:'var(--sf2)',borderRadius:2,overflow:'hidden'}}>
                      <div style={{height:'100%',width:`${r.grossP/maxGrossP*100}%`,
                        background:'rgba(102,255,165,.6)',borderRadius:2}} />
                    </div>
                    <span style={{color:'#66ffa5',minWidth:60,textAlign:'right'}}>{fA(r.grossP)}</span>
                  </div>
                </td>
                <td style={{...TD,textAlign:'right',fontWeight:600,
                  color:r.netP>=0?'#66ffa5':'#ff5258'}}>{fU(Math.round(r.netP))}</td>
                <td style={{...TD,textAlign:'right',fontWeight:700,
                  color:r.grossPct>20?'#66ffa5':r.grossPct>10?'#f0a500':'var(--mu)'}}>
                  {r.grossPct.toFixed(1)}%
                </td>
                <td style={{...TD,textAlign:'right'}}>
                  <div style={{display:'flex',alignItems:'center',gap:6,justifyContent:'flex-end'}}>
                    <div style={{width:36,height:4,background:'var(--sf2)',borderRadius:2,overflow:'hidden'}}>
                      <div style={{height:'100%',width:`${Math.min(100,r.cumGross)}%`,
                        background:'#66ffa5',borderRadius:2}} />
                    </div>
                    <span style={{color:'var(--mu)',fontSize:10}}>{r.cumGross.toFixed(0)}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ── SECTION 3: Tail Cost Analysis ─────────────────────────────────────────────
function TailCostAnalysis({ trades }) {
  const [tailPct, setTailPct] = useState(5)

  const sorted = useMemo(() =>
    [...trades].filter(t=>t.pnl!=null).sort((a,b)=>a.pnl-b.pnl),
  [trades])

  const totalNet = useMemo(() => sorted.reduce((s,t)=>s+t.pnl,0), [sorted])

  const tailStats = useMemo(() => {
    const n = Math.max(1, Math.round(sorted.length * tailPct / 100))
    const tail = sorted.slice(0, n)
    const tailCost = tail.reduce((s,t)=>s+t.pnl,0) // always negative
    const withoutTail = sorted.slice(n)
    const newNet   = withoutTail.reduce((s,t)=>s+t.pnl,0)
    const newWr    = withoutTail.length ? withoutTail.filter(t=>t.pnl>0).length/withoutTail.length : 0
    const newExp   = withoutTail.length ? newNet/withoutTail.length : 0
    const oldExp   = sorted.length ? totalNet/sorted.length : 0
    const worstTrade = tail[0]

    // Symbol breakdown of tail
    const symMap = {}
    tail.forEach(t => {
      if (!symMap[t.symbol]) symMap[t.symbol] = { trades:0, cost:0 }
      symMap[t.symbol].trades++
      symMap[t.symbol].cost += t.pnl
    })
    const topSymbols = Object.entries(symMap)
      .sort((a,b)=>a[1].cost-b[1].cost)
      .slice(0,5)
      .map(([sym,d])=>({sym,...d}))

    return { n, tail, tailCost, newNet, newWr, newExp, oldExp, worstTrade, topSymbols }
  }, [sorted, tailPct, totalNet])

  const expImprovement = tailStats.newExp - tailStats.oldExp
  const netImprovement = tailStats.newNet  - totalNet

  return (
    <Card>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',
        marginBottom:14,flexWrap:'wrap',gap:8}}>
        <SectionHeader
          title="Tail Cost Analysis"
          sub="What is your worst-trade tail costing you? Identifies the trades dragging down expectancy." />
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:10,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>Worst</span>
          <input type="range" min={1} max={20} value={tailPct}
            onChange={e=>setTailPct(+e.target.value)}
            style={{width:80,accentColor:'#ff5258'}} />
          <span style={{fontSize:10,fontWeight:700,color:'#ff5258',fontFamily:'var(--font-mono)',
            minWidth:28}}>{tailPct}%</span>
        </div>
      </div>

      {/* Impact cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',
        gap:8,marginBottom:16}}>
        {[
          ['Trades in tail',  `${tailStats.n}`,                 'var(--tx)'],
          ['Total cost',      fU(Math.round(tailStats.tailCost)), '#ff5258'],
          ['P&L without',     fU(Math.round(tailStats.newNet)),   tailStats.newNet>=0?'#66ffa5':'#ff5258'],
          ['Exp improvement', fU(Math.round(expImprovement)),     expImprovement>=0?'#66ffa5':'#ff5258'],
          ['New win rate',    fP(tailStats.newWr),                tailStats.newWr>=.5?'#66ffa5':'#ff5258'],
        ].map(([label,val,color]) => (
          <div key={label} style={{background:'var(--sf2)',borderRadius:6,padding:'8px 10px'}}>
            <div style={{fontSize:8,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',
              letterSpacing:'.07em',fontFamily:'var(--font-mono)',marginBottom:3}}>{label}</div>
            <div style={{fontSize:13,fontWeight:700,fontFamily:'var(--font-mono)',color,
              overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{val}</div>
          </div>
        ))}
      </div>

      {/* Symbol breakdown of tail */}
      {tailStats.topSymbols.length > 0 && (
        <div style={{marginBottom:14}}>
          <div style={{fontSize:9,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',
            letterSpacing:'.07em',fontFamily:'var(--font-mono)',marginBottom:8}}>
            Where the tail pain comes from
          </div>
          {tailStats.topSymbols.map(r => (
            <div key={r.sym} style={{display:'flex',alignItems:'center',gap:8,
              padding:'5px 0',borderBottom:'1px solid var(--sf2)'}}>
              <span style={{fontSize:11,fontWeight:600,color:'var(--tx)',flex:1}}>{r.sym}</span>
              <span style={{fontSize:10,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>{r.trades}t</span>
              <span style={{fontSize:11,fontWeight:700,color:'#ff5258',fontFamily:'var(--font-mono)',
                minWidth:70,textAlign:'right'}}>{fU(Math.round(r.cost))}</span>
              <div style={{width:50,height:4,background:'var(--sf2)',borderRadius:2,overflow:'hidden'}}>
                <div style={{height:'100%',borderRadius:2,background:'#ff5258',
                  width:`${Math.min(100,Math.abs(r.cost)/Math.abs(tailStats.tailCost)*100)}%`}} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Coaching insight */}
      <div style={{background:'rgba(255,165,0,.06)',border:'1px solid rgba(255,165,0,.2)',
        borderRadius:7,padding:'10px 12px',fontSize:10,color:'var(--mu)',lineHeight:1.6}}>
        <span style={{fontWeight:700,color:'#f0a500'}}>Insight: </span>
        Removing your worst {tailPct}% of trades ({tailStats.n} trades) would
        {' '}<span style={{color:expImprovement>=0?'#66ffa5':'#ff5258',fontWeight:600}}>
          {expImprovement>=0?'increase':'decrease'} per-trade expectancy
          by {fA(Math.abs(expImprovement))}
        </span>
        {' '}and
        {' '}<span style={{color:netImprovement>=0?'#66ffa5':'#ff5258',fontWeight:600}}>
          {netImprovement>=0?'add':'cost'} {fA(Math.abs(netImprovement))} in net P&L
        </span>.
        {tailStats.topSymbols[0] && ` ${tailStats.topSymbols[0].sym} is your biggest tail contributor.`}
      </div>
    </Card>
  )
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────
export default function EdgeConcentration({ trades = [] }) {
  if (!trades.length) return (
    <div style={{padding:40,textAlign:'center',color:'var(--mu)',
      fontFamily:'var(--font-mono)',fontSize:12}}>
      No trades in current date range.
    </div>
  )

  return (
    <div style={{padding:'12px 16px',maxWidth:1400,margin:'0 auto',display:'grid',gap:16}}>
      <ParetoAnalysis    trades={trades} />
      <ConcentrationTable trades={trades} />
      <TailCostAnalysis  trades={trades} />
    </div>
  )
}
