import { useEffect, useRef, useState } from 'react'
import { Chart, registerables } from 'chart.js'

Chart.register(...registerables)

Chart.defaults.color = '#6b7280'
Chart.defaults.borderColor = '#e2e5ea'
Chart.defaults.font.family = "'JetBrains Mono', 'Fira Code', monospace"
Chart.defaults.font.size = 11

const fU   = n => (n>=0?'+':'')+n.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0})
const GRID  = { color:'#f0f2f5', lineWidth:1 }
const TICK  = { color:'#9ca3af', font:{size:10} }
const NOLEG = { display:false }
const TIP   = { backgroundColor:'#fff', titleColor:'#0f1117', bodyColor:'#6b7280', borderColor:'#e2e5ea', borderWidth:1 }

const privTick = (privacy) => (v) => privacy ? '***' : '$'+(v/1000).toFixed(0)+'k'

export default function ChartComp(props) {
  const { type, privacy=false } = props
  if (type==='equity')       return <EquityChart      data={props.data}               privacy={privacy} />
  if (type==='monthly')      return <BarChart   title="MONTHLY P&L"      labels={props.data.map(d=>d.month_str)}   values={props.data.map(d=>Math.round(d.total_pnl))} height={170} privacy={privacy} />
  if (type==='duration')     return <BarChart   title="P&L BY DURATION"  labels={props.data.map(d=>d.bucket)}      values={props.data.map(d=>Math.round(d.total_pnl))} height={170} privacy={privacy} />
  if (type==='direction')    return <DirectionChart longPnl={props.longPnl} shortPnl={props.shortPnl} privacy={privacy} />
  if (type==='distribution') return <DistChart trades={props.trades} privacy={privacy} />
  if (type==='symbolPnl')    return <HBarChart  title="P&L BY SYMBOL"    labels={props.data.map(d=>d.symbol)}      values={props.data.map(d=>Math.round(d.total_pnl))} height={270} privacy={privacy} />
  if (type==='symbolWr')     return <HBarChart  title="WIN RATE BY SYMBOL" labels={props.data.map(d=>d.symbol)}    values={props.data.map(d=>Math.round(d.win_rate*100))} height={270} isWr />
  if (type==='sessionPnl')   return <BarChart   title="SESSION P&L"      labels={props.data.map(d=>d.session)}     values={props.data.map(d=>Math.round(d.total_pnl))} height={200} privacy={privacy} />
  if (type==='sessionWr')    return <WrChart    title="SESSION WIN RATE"  labels={props.data.map(d=>d.session)}     values={props.data.map(d=>Math.round(d.win_rate*100))} height={200} />
  if (type==='dowPnl')       return <BarChart   title="P&L BY DAY"       labels={props.data.map(d=>d.day_of_week)} values={props.data.map(d=>Math.round(d.total_pnl))} height={220} privacy={privacy} />
  if (type==='dowWr')        return <WrChart    title="WIN RATE BY DAY"   labels={props.data.map(d=>d.day_of_week)} values={props.data.map(d=>Math.round(d.win_rate*100))} height={220} />
  if (type==='hourly')       return <HourlyChart     data={props.data}               privacy={privacy} />
  if (type==='streaks')      return <StreaksView      trades={props.trades} stats={props.stats} privacy={privacy} />
  return null
}

// ── EQUITY CURVE ─────────────────────────────────────────────────────────────
function EquityChart({ data, privacy }) {
  const canvasRef = useRef(); const handleRef = useRef(); const chartRef = useRef()

  useEffect(() => {
    if (!canvasRef.current || !data?.length) return
    chartRef.current?.destroy()
    const ctx  = canvasRef.current.getContext('2d')
    const vals = data.map(d => d.cum_pnl)
    const grad = ctx.createLinearGradient(0, 0, 0, 420)
    grad.addColorStop(0, 'rgba(26,86,219,.12)'); grad.addColorStop(1, 'rgba(26,86,219,.01)')

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: { labels: data.map(d=>d.date), datasets: [{ data:vals, borderColor:'#1a56db', borderWidth:2, fill:true, backgroundColor:grad, pointRadius:2, pointBackgroundColor:'#1a56db', tension:.3 }] },
      options: {
        responsive:true, maintainAspectRatio:false, animation:{duration:300},
        plugins: { legend:NOLEG, tooltip:{...TIP, callbacks:{label: c => privacy ? '***' : fU(Math.round(c.parsed.y))}} },
        scales: {
          y: { min:Math.min(0,...vals)*1.12, max:Math.max(...vals)*1.12, grid:GRID, ticks:{...TICK, callback: privacy ? ()=>'***' : v=>'$'+(v/1000).toFixed(0)+'k'} },
          x: { grid:{display:false}, ticks:{...TICK, maxTicksLimit:14, maxRotation:0} },
        }
      }
    })

    let drag=false, dY=0, dMin=0, dMax=0
    const hdl = handleRef.current
    const onDown = e => { drag=true; dY=e.clientY; dMin=chartRef.current.scales.y.min; dMax=chartRef.current.scales.y.max; document.body.style.cursor='ns-resize'; e.preventDefault() }
    const onMove = e => { if(!drag)return; const f=1+(dY-e.clientY)*.004, mid=(dMin+dMax)/2, hr=(dMax-dMin)/2*f; chartRef.current.options.scales.y.min=mid-hr; chartRef.current.options.scales.y.max=mid+hr; chartRef.current.update('none') }
    const onUp   = () => { if(drag){drag=false; document.body.style.cursor=''} }
    hdl?.addEventListener('mousedown', onDown)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
    return () => { chartRef.current?.destroy(); hdl?.removeEventListener('mousedown',onDown); document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp) }
  }, [data, privacy])

  return (
    <div className="card" style={{marginBottom:10}}>
      <div className="ct"><span className="ind" />CUMULATIVE EQUITY CURVE<span style={{marginLeft:'auto',fontSize:10,fontWeight:400}}>Drag right edge ⇅ to rescale</span></div>
      <div style={{position:'relative',userSelect:'none'}}>
        <div style={{position:'relative',height:360}}>
          <canvas ref={canvasRef} style={{position:'absolute',top:0,left:0,width:'100%',height:'100%'}} />
        </div>
        <div ref={handleRef} className="eq-h" />
      </div>
    </div>
  )
}

// ── BAR CHART (P&L) ──────────────────────────────────────────────────────────
function BarChart({ title, labels, values, height, privacy }) {
  const ref = useRef()
  useEffect(() => {
    if (!ref.current) return
    const cs = values.map(v => v>=0?'rgba(5,150,105,.12)':'rgba(220,38,38,.12)')
    const bc = values.map(v => v>=0?'#059669':'#dc2626')
    const ch = new Chart(ref.current, {
      type:'bar',
      data:{ labels, datasets:[{ data:values, backgroundColor:cs, borderColor:bc, borderWidth:1.5, borderRadius:3 }] },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:NOLEG, tooltip:{...TIP, callbacks:{ label: ctx => privacy ? '***' : fU(ctx.parsed.y) }} },
        scales:{
          y:{ grid:GRID, ticks:{...TICK, callback: privacy ? ()=>'***' : v=>'$'+(v/1000).toFixed(0)+'k' } },
          x:{ grid:{display:false}, ticks:{...TICK, maxRotation:45} }
        }
      }
    })
    return () => ch.destroy()
  }, [JSON.stringify(values), privacy])
return (
    <div className="card">
      <div className="ct"><span className="ind" />{title}</div>
      <div style={{position:'relative',height:height}}><canvas ref={ref} style={{position:'absolute',top:0,left:0,width:'100%',height:'100%'}} /></div>
    </div>
  )
}

// ── WIN RATE BAR ─────────────────────────────────────────────────────────────
function WrChart({ title, labels, values, height }) {
  const ref = useRef()
  useEffect(() => {
    if (!ref.current) return
    const cs = values.map(v => v>=65?'rgba(26,86,219,.1)':'rgba(217,119,6,.1)')
    const bc = values.map(v => v>=65?'#1a56db':'#d97706')
    const ch = new Chart(ref.current, {
      type:'bar', data:{labels, datasets:[{data:values, backgroundColor:cs, borderColor:bc, borderWidth:1.5, borderRadius:3}]},
      options:{responsive:true, plugins:{legend:NOLEG, tooltip:TIP},
        scales:{y:{grid:GRID, max:110, ticks:{...TICK, callback:v=>v+'%'}}, x:{grid:{display:false}, ticks:TICK}}}
    })
    return () => ch.destroy()
  }, [JSON.stringify(values)])
  return (<div className="card"><div className="ct"><span className="ind" />{title}</div><canvas ref={ref} height={height} /></div>)
}

// ── HORIZONTAL BAR ───────────────────────────────────────────────────────────
function HBarChart({ title, labels, values, height, isWr, privacy }) {
  const ref = useRef()
  useEffect(() => {
    if (!ref.current) return
    const cs = isWr ? values.map(v=>v>=65?'rgba(26,86,219,.1)':'rgba(217,119,6,.1)') : values.map(v=>v>=0?'rgba(5,150,105,.1)':'rgba(220,38,38,.1)')
    const bc = isWr ? values.map(v=>v>=65?'#1a56db':'#d97706') : values.map(v=>v>=0?'#059669':'#dc2626')
    const ch = new Chart(ref.current, {
      type:'bar', data:{labels, datasets:[{data:values, backgroundColor:cs, borderColor:bc, borderWidth:1.5, borderRadius:3}]},
      options:{indexAxis:'y', responsive:true, plugins:{legend:NOLEG, tooltip:{...TIP, callbacks:{label: c=>isWr?c.parsed.x+'%':(privacy?'***':fU(c.parsed.x))}}},
        scales:{x:{grid:GRID, ticks:{...TICK, callback: isWr ? v=>v+'%' : privTick(privacy||false)}}, y:{grid:{display:false}, ticks:TICK}}}
    })
    return () => ch.destroy()
  }, [JSON.stringify(values), privacy])
  return (<div className="card"><div className="ct"><span className="ind" />{title}</div><canvas ref={ref} height={height} /></div>)
}

// ── DIRECTION DOUGHNUT ───────────────────────────────────────────────────────
function DirectionChart({ longPnl, shortPnl, privacy }) {
  const ref = useRef()
  useEffect(() => {
    if (!ref.current) return
    const ch = new Chart(ref.current, {
      type:'doughnut',
      data:{labels:['Long P&L','Short P&L'], datasets:[{data:[Math.max(longPnl,0),Math.max(shortPnl,0)], backgroundColor:['rgba(5,150,105,.75)','rgba(220,38,38,.65)'], borderColor:['#059669','#dc2626'], borderWidth:1.5}]},
      options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{display:true,position:'bottom',labels:{font:{size:11},padding:14,color:'#6b7280'}},        tooltip:{...TIP, callbacks:{label: c=>privacy?'***':c.label+': '+fU(Math.round(c.parsed))}}}}
    })
    return () => ch.destroy()
  }, [longPnl, shortPnl, privacy])
  return (<div className="card"><div className="ct"><span className="ind" />LONG VS SHORT</div><div style={{position:'relative',height:200}}><canvas ref={ref} /></div></div>)
}

// ── WIN/LOSS DISTRIBUTION ────────────────────────────────────────────────────
function DistChart({ trades, privacy }) {
const [tick, setTick] = useState(0)
  const canvasId = 'dist-' + tick

const wins   = trades?.filter(t=>t.pnl>0) || []
  const losses = trades?.filter(t=>t.pnl<0) || []
  const bkt    = (arr,mn,mx) => arr.filter(t=>Math.abs(t.pnl)>=mn&&(mx===Infinity||Math.abs(t.pnl)<mx)).length
  const wv     = [bkt(wins,20000,Infinity),bkt(wins,10000,20000),bkt(wins,5000,10000),bkt(wins,1000,5000),bkt(wins,0,1000)]
  const lv     = [bkt(losses,20000,Infinity),bkt(losses,10000,20000),bkt(losses,5000,10000),bkt(losses,1000,5000),bkt(losses,0,1000)].map(v=>-v)
  const lbls   = privacy ? ['***','***','***','***','***'] : ['>$20k','$10-20k','$5-10k','$1-5k','<$1k']
  useEffect(() => {
    const canvas = document.getElementById(canvasId)
    if (!canvas) return
    const ch = new Chart(canvas, {
      type:'bar',
      data:{ labels:lbls, datasets:[
        { label:'Wins',   data:wv, backgroundColor:'rgba(5,150,105,.12)', borderColor:'#059669', borderWidth:1.5, borderRadius:3 },
        { label:'Losses', data:lv, backgroundColor:'rgba(220,38,38,.12)', borderColor:'#dc2626', borderWidth:1.5, borderRadius:3 },
      ]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:true,position:'bottom',labels:{font:{size:11},padding:12,color:'#6b7280'}}, tooltip:TIP },
        scales:{ y:{grid:GRID,ticks:TICK}, x:{grid:{display:false},ticks:TICK} },
      },
    })
    return () => ch.destroy()
  }, [canvasId])
  useEffect(() => { setTick(t => t + 1) }, [privacy])
  return (
    <div className="card" style={{minHeight:290}}>
      <div className="ct"><span className="ind" />WIN / LOSS DISTRIBUTION</div>
      <div style={{position:'relative',height:240}}>
        <canvas id={canvasId} style={{position:'absolute',top:0,left:0,width:'100%',height:'100%'}} />
      </div>
    </div>
  )
}

// ── HOURLY CHART ─────────────────────────────────────────────────────────────
function HourlyChart({ data, privacy }) {
  const ref = useRef()
  const hrMap = {}; data?.forEach(h => { hrMap[h.hour] = h })
  const allH   = Array.from({length:24},(_,i)=>i)
  const values = allH.map(h => hrMap[h] ? Math.round(hrMap[h].total_pnl) : 0)
  const cs     = values.map(v => v>=0?'rgba(5,150,105,.12)':'rgba(220,38,38,.12)')
  const bc     = values.map(v => v>=0?'#059669':'#dc2626')
  useEffect(() => {
    if (!ref.current) return
    const ch = new Chart(ref.current, {
      type:'bar',
      data:{labels:allH.map(h=>(h<10?'0':'')+h+':00'), datasets:[{data:values, backgroundColor:cs, borderColor:bc, borderWidth:1.5, borderRadius:3}]},
      options:{responsive:true, plugins:{legend:NOLEG, tooltip:{...TIP, callbacks:{label: c=>{const h=hrMap[c.dataIndex]; return h?[privacy?'***':fU(Math.round(h.total_pnl)),(h.win_rate*100).toFixed(0)+'% WR',h.count+' trades']:[];}}}},
        scales:{y:{grid:GRID, ticks:{...TICK, callback: privTick(privacy)}}, x:{grid:{display:false}, ticks:TICK}}}
    })
    return () => ch.destroy()
  }, [JSON.stringify(values), privacy])
  return (
    <div className="card" style={{marginBottom:10}}>
      <div className="ct"><span className="ind" />P&L BY HOUR (GMT)</div>
      <canvas ref={ref} height={130} />
    </div>
  )
}

// ── STREAKS VISUALISATION ────────────────────────────────────────────────────
function StreaksView({ trades, stats, privacy }) {
  if (!trades?.length || !stats) return (
    <div className="card" style={{textAlign:'center',padding:'40px 20px',color:'var(--mu)'}}>No trade data to show streaks.</div>
  )

  const ov      = stats.overview
  const sorted  = [...trades].sort((a,b) => a.entry_time.localeCompare(b.entry_time))

  const segments = []
  let cur = null
  sorted.forEach((t, i) => {
    const type = t.pnl >= 0 ? 'W' : 'L'
    if (!cur || cur.type !== type) {
      if (cur) segments.push(cur)
      cur = { type, count:1, pnl:t.pnl, trades:[t], start:t.entry_time }
    } else {
      cur.count++; cur.pnl += t.pnl; cur.trades.push(t)
    }
    if (i === sorted.length-1) segments.push(cur)
  })

  const topWin  = [...segments].filter(s=>s.type==='W').sort((a,b)=>b.count-a.count).slice(0,5)
  const topLoss = [...segments].filter(s=>s.type==='L').sort((a,b)=>b.count-a.count).slice(0,5)
  const lastSeg = segments[segments.length-1]

  return (
    <div className="anim">
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(138px,1fr))',gap:8,marginBottom:16}}>
        {[
          ['MAX WIN STREAK',  ov.max_win_streak  + ' trades', 'pos', 'Consecutive wins'],
          ['MAX LOSS STREAK', ov.max_loss_streak + ' trades', 'neg', 'Consecutive losses'],
          ['CURRENT STREAK',  lastSeg ? lastSeg.count + (lastSeg.type==='W'?' wins':' losses') : '—', lastSeg?.type==='W'?'pos':'neg', lastSeg?.type==='W'?'Active win run':'Active loss run'],
          ['TOTAL SEGMENTS',  segments.length, 'neu', 'Streak changes'],
          ['AVG WIN RUN',     (segments.filter(s=>s.type==='W').reduce((a,s)=>a+s.count,0)/Math.max(segments.filter(s=>s.type==='W').length,1)).toFixed(1), 'pos', 'Average win streak length'],
          ['AVG LOSS RUN',    (segments.filter(s=>s.type==='L').reduce((a,s)=>a+s.count,0)/Math.max(segments.filter(s=>s.type==='L').length,1)).toFixed(1), 'neg', 'Average loss streak length'],
        ].map(([l,v,c,s])=>(
          <div key={l} className="kpi">
            <div className="kl">{l}</div>
            <div className={`kv ${c}`}>{v}</div>
            <div className="ks">{s}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{marginBottom:12}}>
        <div className="ct"><span className="ind" />TRADE OUTCOME TIMELINE · Last {Math.min(sorted.length,120)} trades</div>
        <div style={{display:'flex',flexWrap:'wrap',gap:3,marginBottom:8}}>
          {sorted.slice(-120).map((t,i) => {
            const isW = t.pnl >= 0
            return (
              <div key={i} title={`${t.symbol} ${isW?'+':''} ${privacy?'***':fU(t.pnl)} · ${t.entry_time?.slice(0,10)}`}
                style={{width:14,height:14,borderRadius:3,background:isW?'var(--wn)':'var(--ls)',opacity:.85,cursor:'default',flexShrink:0,transition:'transform .1s'}}
                onMouseEnter={e=>e.target.style.transform='scale(1.3)'}
                onMouseLeave={e=>e.target.style.transform='scale(1)'} />
            )
          })}
        </div>
        <div style={{display:'flex',gap:14,fontSize:10,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>
          <span><span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:'var(--wn)',marginRight:4}} />Win</span>
          <span><span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:'var(--ls)',marginRight:4}} />Loss</span>
          <span>· Hover for detail · Left = oldest</span>
        </div>
      </div>

      <div className="card" style={{marginBottom:12}}>
        <div className="ct"><span className="ind" />STREAK LENGTHS — All segments</div>
        <div style={{display:'flex',flexWrap:'wrap',gap:4,alignItems:'flex-end',minHeight:80}}>
          {segments.slice(-80).map((seg,i) => {
            const isW   = seg.type === 'W'
            const maxH  = Math.max(...segments.map(s=>s.count))
            const h     = Math.max(8, Math.round((seg.count / maxH) * 80))
            return (
              <div key={i} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2}} title={`${isW?'Win':'Loss'} streak: ${seg.count} · P&L: ${privacy?'***':fU(Math.round(seg.pnl))}`}>
                <div style={{width:12, height:h, borderRadius:3, background:isW?'var(--wn)':'var(--ls)', opacity:.8, flexShrink:0}} />
                {seg.count > 3 && <div style={{fontSize:8,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>{seg.count}</div>}
              </div>
            )
          })}
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}} className="g2">
        <div className="card">
          <div className="ct"><span className="ind" style={{background:'var(--wn)'}} />TOP WIN STREAKS</div>
          <table style={{width:'100%',borderCollapse:'collapse',fontFamily:'var(--font-mono)'}}>
            <thead><tr>
              {['Length','P&L','From','To'].map(h=><th key={h} style={{textAlign:'left',fontSize:10,fontWeight:600,color:'var(--mu)',padding:'4px 8px',borderBottom:'1px solid var(--bd)',textTransform:'uppercase',letterSpacing:'.06em'}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {topWin.map((s,i)=>(
                <tr key={i}>
                  <td style={{padding:'6px 8px',borderBottom:'1px solid var(--bd)',fontSize:13,fontWeight:700,color:'var(--wn)'}}>{s.count}×</td>
                  <td className="private" style={{padding:'6px 8px',borderBottom:'1px solid var(--bd)',fontSize:11,color:'var(--wn)'}}>{privacy?'***':fU(Math.round(s.pnl))}</td>
                  <td style={{padding:'6px 8px',borderBottom:'1px solid var(--bd)',fontSize:10,color:'var(--mu)'}}>{s.start?.slice(0,10)}</td>
                  <td style={{padding:'6px 8px',borderBottom:'1px solid var(--bd)',fontSize:10,color:'var(--mu)'}}>{s.trades[s.trades.length-1]?.entry_time?.slice(0,10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="ct"><span className="ind" style={{background:'var(--ls)'}} />TOP LOSS STREAKS</div>
          <table style={{width:'100%',borderCollapse:'collapse',fontFamily:'var(--font-mono)'}}>
            <thead><tr>
              {['Length','P&L','From','To'].map(h=><th key={h} style={{textAlign:'left',fontSize:10,fontWeight:600,color:'var(--mu)',padding:'4px 8px',borderBottom:'1px solid var(--bd)',textTransform:'uppercase',letterSpacing:'.06em'}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {topLoss.map((s,i)=>(
                <tr key={i}>
                  <td style={{padding:'6px 8px',borderBottom:'1px solid var(--bd)',fontSize:13,fontWeight:700,color:'var(--ls)'}}>{s.count}×</td>
                  <td className="private" style={{padding:'6px 8px',borderBottom:'1px solid var(--bd)',fontSize:11,color:'var(--ls)'}}>{privacy?'***':fU(Math.round(s.pnl))}</td>
                  <td style={{padding:'6px 8px',borderBottom:'1px solid var(--bd)',fontSize:10,color:'var(--mu)'}}>{s.start?.slice(0,10)}</td>
                  <td style={{padding:'6px 8px',borderBottom:'1px solid var(--bd)',fontSize:10,color:'var(--mu)'}}>{s.trades[s.trades.length-1]?.entry_time?.slice(0,10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── PNL PATH CHART (exported for TradeModal) ─────────────────────────────────
export function PnlPathChart({ sim, trade }) {
  const ref    = useRef()
  const isWin  = trade.pnl >= 0
  const lineC  = isWin ? '#059669' : '#dc2626'
  const fillC  = isWin ? 'rgba(5,150,105,.08)' : 'rgba(220,38,38,.06)'
  const zero   = new Array(sim.timePct.length).fill(0)
  const mfeLine = new Array(sim.timePct.length).fill(Math.round(sim.mfe))
  const maeLine = new Array(sim.timePct.length).fill(Math.round(sim.mae))

  useEffect(() => {
    if (!ref.current) return
    const ch = new Chart(ref.current, {
      type: 'line',
      data: { labels:sim.timePct.map(v=>v+'%'), datasets:[
        {label:'MFE',      data:mfeLine,    borderColor:'rgba(5,150,105,.4)',   borderWidth:1, borderDash:[4,4], pointRadius:0, fill:false, tension:0},
        {label:'MAE',      data:maeLine,    borderColor:'rgba(220,38,38,.4)',   borderWidth:1, borderDash:[4,4], pointRadius:0, fill:false, tension:0},
        {label:'Zero',     data:zero,       borderColor:'rgba(107,114,128,.3)', borderWidth:1, pointRadius:0,    fill:false,    tension:0},
        {label:'P&L Path', data:sim.pnlPath,borderColor:lineC,                 borderWidth:2, pointRadius:0,    fill:{target:2,above:fillC,below:'rgba(220,38,38,.05)'}, tension:.3},
        {label:'Entry',    data:sim.pnlPath.map((_,i)=>i===0?0:null),          pointRadius:sim.pnlPath.map((_,i)=>i===0?6:0), pointBackgroundColor:'#1a56db', pointBorderColor:'#fff', pointBorderWidth:2, showLine:false},
        {label:'Exit',     data:sim.pnlPath.map((v,i)=>i===sim.pnlPath.length-1?v:null), pointRadius:sim.pnlPath.map((_,i)=>i===sim.pnlPath.length-1?6:0), pointBackgroundColor:lineC, pointBorderColor:'#fff', pointBorderWidth:2, showLine:false},
        {label:'Best Exit',data:sim.pnlPath.map(v=>Math.abs(v-sim.mfe)<Math.abs(sim.mfe)*.03&&sim.mfe>0?v:null), pointRadius:sim.pnlPath.map(v=>Math.abs(v-sim.mfe)<Math.abs(sim.mfe)*.03&&sim.mfe>0?5:0), pointBackgroundColor:'#d97706', pointStyle:'triangle', pointBorderColor:'#fff', pointBorderWidth:1.5, showLine:false},
      ]},
      options:{responsive:true, interaction:{mode:'index',intersect:false},
        plugins:{legend:{display:true,position:'bottom',labels:{boxWidth:10,font:{size:10},padding:10,color:'#6b7280',filter:item=>['P&L Path','MFE','MAE','Best Exit'].includes(item.text)}},
          tooltip:{...TIP, callbacks:{label: c=>c.dataset.label+': '+fU(c.parsed.y)}}},
        scales:{y:{grid:GRID, ticks:{...TICK, callback:v=>fU(v)}}, x:{grid:{display:false}, ticks:{...TICK, maxTicksLimit:10}}}}
    })
    return () => ch.destroy()
  }, [JSON.stringify(sim)])

  return <canvas ref={ref} height={90} />
}
