import { useEffect, useRef, useState } from 'react'
import { Chart, registerables } from 'chart.js'

Chart.register(...registerables)

Chart.defaults.color = '#6b7280'
Chart.defaults.borderColor = '#e2e5ea'
Chart.defaults.font.family = "'JetBrains Mono', 'Fira Code', monospace"
Chart.defaults.font.size = 11

const fU   = n => (n>=0?'+':'')+n.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0})
const GRID  = { color:'rgba(255,255,255,0.06)', lineWidth:1 }
const TICK  = { color:'#9ca3af', font:{size:10} }
const NOLEG = { display:false }
const TIP   = { backgroundColor:'#fff', titleColor:'#0f1117', bodyColor:'#6b7280', borderColor:'#e2e5ea', borderWidth:1 }

const privTick = (privacy) => (v) => privacy ? '***' : '$'+(v/1000).toFixed(0)+'k'

export default function ChartComp(props) {
  const { type, privacy=false } = props
  if (type==='equity')       return <EquityChart      data={props.data}               privacy={privacy} />
  if (type==='monthly') {
    const allMonths = props.data.map(d => d.month_str)
    const years = [...new Set(allMonths.map(s => s.split('-')[0]))]
    const multiYear = years.length > 1
    const fmtMonth = (s, i) => {
      const [y, m] = s.split('-')
      const mon = new Date(+y, +m-1, 1).toLocaleDateString('en-GB', { month:'short' })
      if (!multiYear) return mon
      // Multi-year: show year only at January boundary
      const prev = i > 0 ? allMonths[i-1].split('-') : null
      const yearChange = prev && prev[0] !== y
      return (+m === 1 && yearChange) ? `${mon} '${y.slice(2)}` : mon
    }
    const labels = props.data.map((d, i) => fmtMonth(d.month_str, i))
    return <BarChart title="MONTHLY P&L" labels={labels} values={props.data.map(d=>Math.round(d.total_pnl))} height={220} cardHeight={280} privacy={privacy} />
  }
  if (type==='duration')     return <BarChart   title="P&L BY DURATION"  labels={props.data.map(d=>d.bucket)}      values={props.data.map(d=>Math.round(d.total_pnl))} height={200} cardHeight={270} privacy={privacy} />
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
  const canvasRef = useRef(); const yAxisRef = useRef(); const chartRef = useRef()

  // Format x-axis tick label (short, for axis display)
  const fmtDate = (d, i, all) => {
    const dt   = new Date(d + 'T00:00:00Z')
    const mon  = dt.toLocaleDateString('en-GB', { month:'short', timeZone:'UTC' })
    if (!all) return mon
    const years = [...new Set(all.map(x => x.date.slice(0,4)))]
    if (years.length <= 1) return mon
    // Multi-year: show year only when year changes at January
    const prev = i > 0 ? new Date(all[i-1].date + 'T00:00:00Z') : null
    const yearChange = prev && prev.getUTCFullYear() !== dt.getUTCFullYear()
    const yr = dt.toLocaleDateString('en-GB', { year:'2-digit', timeZone:'UTC' })
    return (dt.getUTCMonth() === 0 && yearChange) ? `${mon} '${yr}` : mon
  }

  // Format tooltip date: "May 20" or "May 20 '24" for multi-year datasets
  const fmtTooltipDate = (d, all) => {
    const dt  = new Date(d + 'T00:00:00Z')
    const mon = dt.toLocaleDateString('en-US', { month:'short', timeZone:'UTC' })
    const day = dt.getUTCDate()
    const years = all ? [...new Set(all.map(x => x.date.slice(0,4)))] : []
    if (years.length > 1) {
      const yr = String(dt.getUTCFullYear()).slice(2)
      return `${mon} ${day} '${yr}`
    }
    return `${mon} ${day}`
  }

  useEffect(() => {
    if (!canvasRef.current || !data?.length) return
    chartRef.current?.destroy()
    const ctx  = canvasRef.current.getContext('2d')
    const vals = data.map(d => d.cum_pnl)
    const grad = ctx.createLinearGradient(0, 0, 0, 360)
    grad.addColorStop(0, 'rgba(102,255,165,.14)'); grad.addColorStop(1, 'rgba(102,255,165,.01)')

    // X-axis tick labels (short month, year on boundary)
    const xLabels = data.map((d, i) => fmtDate(d.date, i, data))
    // Keep full date strings for tooltip lookup
    const rawDates = data.map(d => d.date)

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: [{
          data: vals,
          borderColor: '#66ffa5',
          borderWidth: 2,
          fill: true,
          backgroundColor: grad,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: '#66ffa5',
          pointHoverBorderColor: '#fff',
          pointHoverBorderWidth: 1.5,
          tension: 0  // straight lines between real data points — no simulation
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration:300 },
        interaction: { mode:'index', intersect:false },
        plugins: {
          legend: NOLEG,
          tooltip: {
            ...TIP,
            callbacks: {
              title: items => {
                const idx = items[0]?.dataIndex
                return (idx != null && rawDates[idx])
                  ? fmtTooltipDate(rawDates[idx], data)
                  : items[0]?.label || ''
              },
              label: c => privacy ? '  ***' : '  ' + fU(Math.round(c.parsed.y))
            }
          }
        },
        scales: {
          y: {
            min: Math.min(0, ...vals) * 1.12,
            max: Math.max(...vals) * 1.12,
            grid: GRID,
            ticks: { ...TICK, callback: privacy ? () => '***' : v => '$' + (v/1000).toFixed(0) + 'k' }
          },
          x: { grid: { display:false }, ticks: { ...TICK, maxTicksLimit:10, maxRotation:0 } },
        }
      }
    })

    // Y-axis drag — left 52px of canvas, supports both mouse (desktop) and touch (mobile)
    let drag=false, dY=0, dMin=0, dMax=0
    const cvs = canvasRef.current

    const startDrag = (clientX, clientY) => {
      const rect = cvs.getBoundingClientRect()
      if ((clientX - rect.left) > 52) return false
      drag=true; dY=clientY
      dMin=chartRef.current.scales.y.min; dMax=chartRef.current.scales.y.max
      return true
    }
    const moveDrag = clientY => {
      if (!drag) return
      const f = 1 + (dY - clientY) * .004
      const mid = (dMin + dMax) / 2
      const hr  = (dMax - dMin) / 2 * f
      chartRef.current.options.scales.y.min = mid - hr
      chartRef.current.options.scales.y.max = mid + hr
      chartRef.current.update('none')
    }
    const endDrag = () => { drag=false; document.body.style.cursor='' }

    // Mouse events
    const onDown = e => {
      if (startDrag(e.clientX, e.clientY)) {
        document.body.style.cursor = 'ns-resize'
        e.preventDefault()
      }
    }
    const onMove = e => moveDrag(e.clientY)
    const onUp   = () => endDrag()

    // Touch events (passive:false so we can preventDefault to block scroll while dragging)
    const onTouchStart = e => {
      const t = e.touches[0]
      if (startDrag(t.clientX, t.clientY)) e.preventDefault()
    }
    const onTouchMove = e => {
      if (drag) { moveDrag(e.touches[0].clientY); e.preventDefault() }
    }
    const onTouchEnd = () => endDrag()

    cvs?.addEventListener('mousedown',  onDown)
    cvs?.addEventListener('touchstart', onTouchStart, { passive:false })
    document.addEventListener('mousemove',  onMove)
    document.addEventListener('mouseup',    onUp)
    document.addEventListener('touchmove',  onTouchMove, { passive:false })
    document.addEventListener('touchend',   onTouchEnd)

    return () => {
      chartRef.current?.destroy()
      cvs?.removeEventListener('mousedown',  onDown)
      cvs?.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('mousemove',  onMove)
      document.removeEventListener('mouseup',    onUp)
      document.removeEventListener('touchmove',  onTouchMove)
      document.removeEventListener('touchend',   onTouchEnd)
    }
  }, [data, privacy])

  return (
    <div className="card" style={{marginBottom:10}}>
      <div className="ct"><span className="ind" />CUMULATIVE EQUITY CURVE<span style={{marginLeft:'auto',fontSize:10,fontWeight:400,color:'var(--mu)'}}>Drag y-axis ⇅ to rescale</span></div>
      <div style={{position:'relative',userSelect:'none'}}>
        <div style={{position:'relative',height:360,width:'100%'}}>
          <canvas ref={canvasRef} style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',cursor:'crosshair'}} />
        </div>
      </div>
    </div>
  )
}

// ── BAR CHART (P&L) ──────────────────────────────────────────────────────────
function BarChart({ title, labels, values, height=252, cardHeight=300, privacy }) {
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
        plugins:{ legend:NOLEG, tooltip:{...TIP, callbacks:{
          title: items => items[0]?.label || '',
          label: ctx => privacy ? '  ***' : '  ' + fU(ctx.parsed.y)
        }} },
        scales:{
          y:{ grid:GRID, ticks:{...TICK, callback: privacy ? ()=>'***' : v=>'$'+(v/1000).toFixed(0)+'k' } },
          x:{ grid:{display:false}, ticks:{...TICK, maxRotation:45} }
        }
      }
    })
    return () => ch.destroy()
  }, [JSON.stringify(values), privacy])
  return (
    <div className="card" style={{height:cardHeight,boxSizing:'border-box'}}>
      <div className="ct"><span className="ind" />{title}</div>
      <div style={{position:'relative',height}}><canvas ref={ref} style={{position:'absolute',top:0,left:0,width:'100%',height:'100%'}} /></div>
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
      data:{labels:['Long P&L','Short P&L'], datasets:[{data:[Math.max(longPnl,0),Math.max(shortPnl,0)], backgroundColor:['rgba(0,181,163,.75)','rgba(255,179,0,.65)'], borderColor:['#00b5a3','#ffb300'], borderWidth:1.5}]},
      options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{display:true,position:'bottom',labels:{font:{size:11},padding:14,color:'#6b7280'}},
        tooltip:{...TIP, callbacks:{label: c=>privacy?'***':c.label+': '+fU(Math.round(c.parsed))}}}}
    })
    return () => ch.destroy()
  }, [longPnl, shortPnl, privacy])
  return (
    <div className="card" style={{height:300,boxSizing:'border-box'}}>
      <div className="ct"><span className="ind" />LONG VS SHORT</div>
      <div style={{position:'relative',height:252}}><canvas ref={ref} style={{position:'absolute',top:0,left:0,width:'100%',height:'100%'}} /></div>
    </div>
  )
}

// ── WIN/LOSS DISTRIBUTION ────────────────────────────────────────────────────
function DistChart({ trades, privacy }) {
  if (!trades?.length) return (
    <div className="card" style={{height:300,boxSizing:'border-box'}}>
      <div className="ct"><span className="ind" />P&L DISTRIBUTION</div>
      <div style={{color:'var(--mu)',fontSize:12,padding:'20px 0'}}>No data</div>
    </div>
  )

  const wins    = trades.filter(t => t.pnl > 0)
  const losses  = trades.filter(t => t.pnl < 0)
  const avgWin  = wins.length   ? wins.reduce((s,t)   => s+t.pnl, 0) / wins.length   : 0
  const avgLoss = losses.length ? losses.reduce((s,t) => s+t.pnl, 0) / losses.length : 0

  // Adaptive bucket boundaries based on 10th–90th percentile of each side
  const sortedWins   = wins.map(t=>t.pnl).sort((a,b)=>a-b)
  const sortedLosses = losses.map(t=>t.pnl).sort((a,b)=>b-a) // most negative first
  const pct = (arr, p) => arr[Math.floor(arr.length * p)] || 0
  const p90Win  = pct(sortedWins,   0.9)
  const p90Loss = Math.abs(pct(sortedLosses, 0.9))

  // Round step to a clean number
  const cleanStep = v => {
    const mag = Math.pow(10, Math.floor(Math.log10(v||1)))
    const n   = v / mag
    return (n < 2 ? 1 : n < 5 ? 2 : 5) * mag
  }
  const winStep  = cleanStep(p90Win  / 4) || 1000
  const lossStep = cleanStep(p90Loss / 4) || 1000
  const step     = Math.max(winStep, lossStep) // keep symmetric

  const NBUCKETS = 5
  const buckets  = []

  // Outer loss
  buckets.push({ count: trades.filter(t=>t.pnl < -NBUCKETS*step).length, isLoss:true,
    label:`<-${Math.round(NBUCKETS*step/1000)}k` })
  // Loss buckets (most neg → just below 0)
  for (let i = NBUCKETS; i >= 1; i--) {
    const lo = -i*step, hi = -(i-1)*step
    const mid = (lo+hi)/2
    const fmt = v => Math.abs(v)>=1000 ? Math.round(v/1000)+'k' : Math.round(v)
    buckets.push({ count: trades.filter(t=>t.pnl>=lo && t.pnl<hi).length,
      isLoss:true, midVal:mid, label:fmt(mid) })
  }
  // Win buckets (0 → most pos)
  for (let i = 1; i <= NBUCKETS; i++) {
    const lo = (i-1)*step, hi = i*step
    const mid = (lo+hi)/2
    const fmt = v => Math.abs(v)>=1000 ? '+'+Math.round(v/1000)+'k' : '+'+Math.round(v)
    buckets.push({ count: trades.filter(t=>t.pnl>=lo && t.pnl<hi).length,
      isLoss:false, midVal:mid, label:fmt(mid) })
  }
  // Outer win
  buckets.push({ count: trades.filter(t=>t.pnl >= NBUCKETS*step).length, isLoss:false,
    label:`>+${Math.round(NBUCKETS*step/1000)}k` })

  const maxCount = Math.max(...buckets.map(b=>b.count), 1)
  const domain   = (NBUCKETS+1) * step
  const W=460, H=260, padX=14, padTop=28, padBot=44
  const plotW    = W - padX*2
  const bw       = plotW / buckets.length
  const xPos     = v => padX + ((v+domain)/(domain*2)) * plotW
  const barH     = c => (c/maxCount) * (H-padTop-padBot)
  const fmtAvg   = v => { const a=Math.abs(v); return (v>=0?'+':'-')+'$'+(a>=1000?(a/1000).toFixed(1)+'k':Math.round(a)) }

  const avgWinX  = Math.min(Math.max(xPos(avgWin),  padX+50), W-padX-2)
  const avgLossX = Math.min(Math.max(xPos(avgLoss), padX+2),  W-padX-52)

  return (
    <div className="card" style={{height:300,boxSizing:'border-box',display:'flex',flexDirection:'column'}}>
      <div className="ct"><span className="ind" />P&L DISTRIBUTION</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:'block',flex:1}}>
        {/* Zero line */}
        <line x1={W/2} y1={padTop} x2={W/2} y2={H-padBot} stroke="#4a5a6a" strokeWidth={1} opacity={0.5} />

        {/* Bars */}
        {buckets.map((b,i) => {
          const h = barH(b.count)
          const x = padX + i*bw
          return (
            <g key={i}>
              <rect x={x+1.5} y={H-padBot-h} width={bw-3} height={Math.max(h,b.count?1.5:0)}
                fill={b.isLoss?'#ff5258':'#00c87a'} opacity={0.6} rx={2} />
              {b.count > 0 && <text x={x+bw/2} y={H-padBot-h-4} textAnchor="middle"
                fontSize={9} fill="#9ca3af" fontFamily="var(--font-mono)">{privacy?'*':b.count}</text>}
              <text x={x+bw/2} y={H-padBot+13} textAnchor="middle"
                fontSize={9} fill="#9ca3af" fontFamily="var(--font-mono)">{b.label}</text>
            </g>
          )
        })}

        {/* Avg Loss dashed marker */}
        {!privacy && avgLoss !== 0 && <>
          <line x1={avgLossX} y1={padTop+2} x2={avgLossX} y2={H-padBot}
            stroke="#8899aa" strokeWidth={1.5} strokeDasharray="5,4" opacity={0.7} />
          <rect x={avgLossX-62} y={padTop-2} width={60} height={15}
            fill="#1a2330" stroke="#6b7280" strokeWidth={0.5} rx={2} opacity={0.95} />
          <text x={avgLossX-32} y={padTop+8.5} textAnchor="middle"
            fontSize={9} fill="#9ca3af" fontFamily="var(--font-mono)">AvgL {fmtAvg(avgLoss)}</text>
        </>}

        {/* Avg Win dashed marker */}
        {!privacy && avgWin !== 0 && <>
          <line x1={avgWinX} y1={padTop+2} x2={avgWinX} y2={H-padBot}
            stroke="#8899aa" strokeWidth={1.5} strokeDasharray="5,4" opacity={0.7} />
          <rect x={avgWinX+1} y={padTop-2} width={60} height={15}
            fill="#1a2330" stroke="#6b7280" strokeWidth={0.5} rx={2} opacity={0.95} />
          <text x={avgWinX+31} y={padTop+8.5} textAnchor="middle"
            fontSize={9} fill="#9ca3af" fontFamily="var(--font-mono)">AvgW {fmtAvg(avgWin)}</text>
        </>}

        {/* Axis labels */}
        <text x={padX}   y={H-padBot+26} fontSize={9} fill="#9ca3af" fontFamily="var(--font-mono)">← LOSSES</text>
        <text x={W/2}    y={H-padBot+26} textAnchor="middle" fontSize={9} fill="#9ca3af" fontFamily="var(--font-mono)">$0</text>
        <text x={W-padX} y={H-padBot+26} textAnchor="end"    fontSize={9} fill="#9ca3af" fontFamily="var(--font-mono)">WINS →</text>
      </svg>
    </div>
  )
}


// ── TOP 5 INSTRUMENTS BY P&L ─────────────────────────────────────────────────
export function Top5PnlChart({ trades, mode, privacy }) {
  const ref = useRef()

  // Aggregate by symbol
  const symMap = {}
  trades?.forEach(t => {
    if (!symMap[t.symbol]) symMap[t.symbol] = 0
    symMap[t.symbol] += t.pnl || 0
  })

  // Filter by positive or negative, sort, take top 5
  const entries = Object.entries(symMap)
    .filter(([,v]) => mode === 'positive' ? v > 0 : v < 0)
    .sort((a,b) => mode === 'positive' ? b[1]-a[1] : a[1]-b[1])
    .slice(0,5)

  const labels = entries.map(([s]) => s)
  const values = entries.map(([,v]) => Math.round(v))
  const color  = mode === 'positive' ? 'rgba(5,150,105,.25)' : 'rgba(220,38,38,.25)'
  const border = mode === 'positive' ? '#059669' : '#dc2626'
  const title  = mode === 'positive' ? 'TOP 5 INSTRUMENTS — BEST P&L' : 'TOP 5 INSTRUMENTS — WORST P&L'

  useEffect(() => {
    if (!ref.current) return
    const ch = new Chart(ref.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: values.map(v => Math.abs(v)),
          backgroundColor: color,
          borderColor: border,
          borderWidth: 1.5,
          borderRadius: 4,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: NOLEG,
          tooltip: { ...TIP, callbacks: { label: ctx => privacy ? '***' : fU(ctx.parsed.x * (mode==='positive'?1:-1)) } }
        },
        scales: {
          x: { grid: GRID, ticks: { ...TICK, callback: v => privacy ? '***' : '$'+(v/1000).toFixed(0)+'k' } },
          y: { grid: { display: false }, ticks: { ...TICK, font: { size: 11 } } }
        }
      }
    })
    return () => ch.destroy()
  }, [JSON.stringify(values), JSON.stringify(labels), privacy])

  return (
    <div className="card" style={{height:300,boxSizing:'border-box'}}>
      <div className="ct"><span className="ind" />{title}</div>
      {entries.length === 0
        ? <div style={{color:'var(--mu)',fontSize:12,padding:'20px 0'}}>No data</div>
        : <div style={{position:'relative',height:252}}><canvas ref={ref} style={{position:'absolute',top:0,left:0,width:'100%',height:'100%'}} /></div>
      }
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
      options:{responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
        plugins:{legend:{display:true,position:'bottom',labels:{boxWidth:10,font:{size:10},padding:10,color:'#6b7280',filter:item=>['P&L Path','MFE','MAE','Best Exit'].includes(item.text)}},
          tooltip:{...TIP, callbacks:{label: c=>c.dataset.label+': '+fU(c.parsed.y)}}},
        scales:{y:{grid:GRID, ticks:{...TICK, callback:v=>fU(v)}}, x:{grid:{display:false}, ticks:{...TICK, maxTicksLimit:10}}}}
    })
    return () => ch.destroy()
  }, [JSON.stringify(sim)])

  return (
    <div style={{position:'relative', height:280}}>
      <canvas ref={ref} style={{position:'absolute',top:0,left:0,width:'100%',height:'100%'}} />
    </div>
  )
}
