import { useEffect, useRef } from 'react'
import { Chart, registerables } from 'chart.js'

Chart.register(...registerables)
Chart.defaults.color = '#6b6b85'
Chart.defaults.borderColor = '#1e1e2e'
Chart.defaults.font.family = "'DM Mono', monospace"

const fU = (n) => (n >= 0 ? '+' : '') + n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

function useChart(canvasRef, config) {
  const chartRef = useRef(null)
  useEffect(() => {
    if (!canvasRef.current) return
    chartRef.current?.destroy()
    chartRef.current = new Chart(canvasRef.current, config)
    return () => chartRef.current?.destroy()
  }, [JSON.stringify(config)])
}


export default function ChartComp(props) {
  const { type } = props

  if (type === 'equity') return <EquityChart data={props.data} />
  if (type === 'monthly') return <SimpleBarChart title="Monthly P&L" labels={props.data.map(d => d.month_str)} values={props.data.map(d => Math.round(d.total_pnl))} height={170} />
  if (type === 'duration') return <SimpleBarChart title="P&L by Duration" labels={props.data.map(d => d.bucket)} values={props.data.map(d => Math.round(d.total_pnl))} height={170} />
  if (type === 'direction') return <DirectionChart longPnl={props.longPnl} shortPnl={props.shortPnl} />
  if (type === 'distribution') return <DistributionChart trades={props.trades} />
  if (type === 'symbolPnl') return <HBarChart title="P&L by Symbol" labels={props.data.map(d => d.symbol)} values={props.data.map(d => Math.round(d.total_pnl))} height={260} />
  if (type === 'symbolWr') return <HBarChart title="Win Rate by Symbol" labels={props.data.map(d => d.symbol)} values={props.data.map(d => Math.round(d.win_rate * 100))} height={260} isWr />
  if (type === 'sessionPnl') return <SimpleBarChart title="Session P&L" labels={props.data.map(d => d.session)} values={props.data.map(d => Math.round(d.total_pnl))} height={200} />
  if (type === 'sessionWr') return <WrBarChart title="Session Win Rate" labels={props.data.map(d => d.session)} values={props.data.map(d => Math.round(d.win_rate * 100))} height={200} />
  if (type === 'dowPnl') return <SimpleBarChart title="P&L by Day" labels={props.data.map(d => d.day_of_week)} values={props.data.map(d => Math.round(d.total_pnl))} height={220} />
  if (type === 'dowWr') return <WrBarChart title="Win Rate by Day" labels={props.data.map(d => d.day_of_week)} values={props.data.map(d => Math.round(d.win_rate * 100))} height={220} />
  if (type === 'hourly') return <HourlyChart data={props.data} />
  if (type === 'pnlPath') return <PnlPathChart sim={props.sim} trade={props.trade} />
  return null
}

// In the BarCard component (for monthly chart):
export function BarCard({ title, labels, values, height = 130 }) {
  const canvasRef = useRef()
  
  useEffect(() => {
    if (!canvasRef.current) return
    
    const ctx = canvasRef.current.getContext('2d')
    const chart = new Chart(ctx, {
      type: 'bar',
       {
        labels: labels.filter(l => l && l !== 'Unknown'), // Filter out unknown labels
        datasets: [{
           values.filter((_, i) => labels[i] && labels[i] !== 'Unknown'),
          backgroundColor: values.map(v => v >= 0 ? 'rgba(75, 222, 128, 0.6)' : 'rgba(185, 65, 68, 0.6)'),
          borderColor: values.map(v => v >= 0 ? '#4bde80' : '#b94144'),
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            grid: { color: 'rgba(48, 54, 61, 0.5)' },
            ticks: { color: '#8b949e', font: { size: 10 } }
          },
          x: {
            grid: { display: false },
            ticks: { 
              color: '#8b949e', 
              font: { size: 9 },
              maxRotation: 45,
              minRotation: 45
            }
          }
        }
      }
    })
    
    return () => chart.destroy()
  }, [labels, values])
  
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="card-title">
        <span className="indicator" />
        {title}
      </div>
      <canvas ref={canvasRef} height={height} />
    </div>
  )
}
function EquityChart({ data }) {
  const ref = useRef()
  const handleRef = useRef()
  const chartRef = useRef()

  useEffect(() => {
    if (!ref.current || !data?.length) return
    chartRef.current?.destroy()
    const ctx = ref.current.getContext('2d')
    const grad = ctx.createLinearGradient(0, 0, 0, 500)
    grad.addColorStop(0, 'rgba(124,106,247,.22)')
    grad.addColorStop(1, 'rgba(124,106,247,0)')
    const vals = data.map(d => d.cum_pnl)
    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: { labels: data.map(d => d.date), datasets: [{ data: vals, borderColor: '#7c6af7', borderWidth: 2, fill: true, backgroundColor: grad, pointRadius: 2, pointBackgroundColor: '#7c6af7', tension: .3 }] },
      options: { responsive: true, animation: { duration: 300 }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fU(Math.round(c.parsed.y)) } } }, scales: { y: { min: Math.min(0, ...vals) * 1.12, max: Math.max(...vals) * 1.12, grid: { color: '#1e1e2e' }, ticks: { callback: v => '$' + (v / 1000).toFixed(0) + 'k' } }, x: { grid: { color: 'rgba(30,30,46,.4)' }, ticks: { maxTicksLimit: 14, maxRotation: 0 } } } }
    })
    // Draggable Y axis
    let drag = false, dY = 0, dMin = 0, dMax = 0
    const hdl = handleRef.current
    const onDown = e => { drag = true; dY = e.clientY; dMin = chartRef.current.scales.y.min; dMax = chartRef.current.scales.y.max; document.body.style.cursor = 'ns-resize'; e.preventDefault() }
    const onMove = e => { if (!drag) return; const f = 1 + (dY - e.clientY) * .004, mid = (dMin + dMax) / 2, hr = (dMax - dMin) / 2 * f; chartRef.current.options.scales.y.min = mid - hr; chartRef.current.options.scales.y.max = mid + hr; chartRef.current.update('none') }
    const onUp = () => { if (drag) { drag = false; document.body.style.cursor = '' } }
    hdl?.addEventListener('mousedown', onDown)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { chartRef.current?.destroy(); hdl?.removeEventListener('mousedown', onDown); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [data])

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 11, fontWeight: 700, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 7 }}>
        <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--ac)' }} />Cumulative Equity Curve
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--mu)', fontWeight: 400 }}>Drag right edge ⇅ to rescale</span>
      </div>
      <div style={{ position: 'relative', userSelect: 'none' }}>
        <canvas ref={ref} height={140} />
        <div ref={handleRef} className="eq-handle" />
      </div>
    </div>
  )
}

function SimpleBarChart({ title, labels, values, height }) {
  const ref = useRef()
  const colors = values.map(v => v >= 0 ? 'rgba(78,203,141,.75)' : 'rgba(240,84,110,.75)')
  useChart(ref, {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 4 }] },
    options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fU(c.parsed.y) } } }, scales: { y: { grid: { color: '#1e1e2e' }, ticks: { callback: v => '$' + (v / 1000).toFixed(0) + 'k' } }, x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 10 } } } } }
  })
  return (
    <div className="card">
      <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 11, fontWeight: 700, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 12 }}>{title}</div>
      <canvas ref={ref} height={height} />
    </div>
  )
}

function WrBarChart({ title, labels, values, height }) {
  const ref = useRef()
  const colors = values.map(v => v >= 65 ? 'rgba(124,106,247,.75)' : 'rgba(247,168,106,.75)')
  useChart(ref, {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 4 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { grid: { color: '#1e1e2e' }, max: 110, ticks: { callback: v => v + '%' } }, x: { grid: { display: false } } } }
  })
  return (
    <div className="card">
      <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 11, fontWeight: 700, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 12 }}>{title}</div>
      <canvas ref={ref} height={height} />
    </div>
  )
}

function HBarChart({ title, labels, values, height, isWr }) {
  const ref = useRef()
  const colors = isWr ? values.map(v => v >= 65 ? 'rgba(124,106,247,.75)' : 'rgba(247,168,106,.75)') : values.map(v => v >= 0 ? 'rgba(78,203,141,.75)' : 'rgba(240,84,110,.75)')
  useChart(ref, {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 4 }] },
    options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { color: '#1e1e2e' }, ticks: { callback: v => isWr ? v + '%' : '$' + (v / 1000).toFixed(0) + 'k' } }, y: { grid: { display: false } } } }
  })
  return (
    <div className="card">
      <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 11, fontWeight: 700, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 12 }}>{title}</div>
      <canvas ref={ref} height={height} />
    </div>
  )
}

function DirectionChart({ longPnl, shortPnl }) {
  const ref = useRef()
  useChart(ref, {
    type: 'doughnut',
    data: { labels: ['Long P&L', 'Short P&L'], datasets: [{ data: [Math.max(longPnl, 0), Math.max(shortPnl, 0)], backgroundColor: ['rgba(78,203,141,.8)', 'rgba(240,84,110,.7)'], borderWidth: 0 }] },
    options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 10 } }, tooltip: { callbacks: { label: c => c.label + ': ' + fU(Math.round(c.parsed)) } } } }
  })
  return (
    <div className="card">
      <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 11, fontWeight: 700, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 12 }}>Long vs Short</div>
      <canvas ref={ref} height={170} />
    </div>
  )
}

function DistributionChart({ trades }) {
  const ref = useRef()
  const wins = trades?.filter(t => t.pnl > 0) || []
  const losses = trades?.filter(t => t.pnl < 0) || []
  const bucket = (arr, min, max) => arr.filter(t => Math.abs(t.pnl) >= min && (max === Infinity || Math.abs(t.pnl) < max)).length
  const labels = ['>$20k', '$10-20k', '$5-10k', '$1-5k', '<$1k']
  const wVals = [bucket(wins, 20000, Infinity), bucket(wins, 10000, 20000), bucket(wins, 5000, 10000), bucket(wins, 1000, 5000), bucket(wins, 0, 1000)]
  const lVals = [bucket(losses, 20000, Infinity), bucket(losses, 10000, 20000), bucket(losses, 5000, 10000), bucket(losses, 1000, 5000), bucket(losses, 0, 1000)].map(v => -v)
  useChart(ref, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Wins', data: wVals, backgroundColor: 'rgba(78,203,141,.7)', borderRadius: 4 }, { label: 'Losses', data: lVals, backgroundColor: 'rgba(240,84,110,.7)', borderRadius: 4 }] },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { grid: { color: '#1e1e2e' } }, x: { grid: { display: false } } } }
  })
  return (
    <div className="card">
      <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 11, fontWeight: 700, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 12 }}>Win/Loss Distribution</div>
      <canvas ref={ref} height={170} />
    </div>
  )
}

function HourlyChart({ data }) {
  const ref = useRef()
  const hrMap = {}
  data?.forEach(h => { hrMap[h.hour] = h })
  const allH = Array.from({ length: 24 }, (_, i) => i)
  useChart(ref, {
    type: 'bar',
    data: { labels: allH.map(h => (h < 10 ? '0' : '') + h + ':00'), datasets: [{ data: allH.map(h => hrMap[h] ? Math.round(hrMap[h].total_pnl) : 0), backgroundColor: allH.map(h => { const d = hrMap[h]; return d ? d.total_pnl >= 0 ? 'rgba(78,203,141,.75)' : 'rgba(240,84,110,.75)' : '#1e1e2e' }), borderRadius: 3 }] },
    options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => { const h = hrMap[c.dataIndex]; return h ? [fU(Math.round(h.total_pnl)), (h.win_rate * 100).toFixed(0) + '% WR', h.count + ' trades'] : [] } } } }, scales: { y: { grid: { color: '#1e1e2e' }, ticks: { callback: v => '$' + (v / 1000).toFixed(0) + 'k' } }, x: { grid: { display: false } } } }
  })
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 11, fontWeight: 700, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 12 }}>P&L by Hour (GMT)</div>
      <canvas ref={ref} height={130} />
    </div>
  )
}

export function PnlPathChart({ sim, trade }) {
  const ref = useRef()
  const { timePct, pnlPath, mae, mfe } = sim
  const pnlColor = trade.pnl >= 0 ? 'rgba(78,203,141,1)' : 'rgba(240,84,110,1)'
  const pnlFill = trade.pnl >= 0 ? 'rgba(78,203,141,0.1)' : 'rgba(240,84,110,0.1)'
  const zero = new Array(timePct.length).fill(0)
  const mfeLine = new Array(timePct.length).fill(Math.round(mfe))
  const maeLine = new Array(timePct.length).fill(Math.round(mae))
  useChart(ref, {
    type: 'line',
    data: {
      labels: timePct.map(v => v + '%'),
      datasets: [
        { label: 'MFE', data: mfeLine, borderColor: 'rgba(78,203,141,.35)', borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: false, tension: 0 },
        { label: 'MAE', data: maeLine, borderColor: 'rgba(240,84,110,.35)', borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: false, tension: 0 },
        { label: 'Zero', data: zero, borderColor: 'rgba(255,255,255,.12)', borderWidth: 1, pointRadius: 0, fill: false, tension: 0 },
        { label: 'P&L Path', data: pnlPath, borderColor: pnlColor, borderWidth: 2, pointRadius: 0, fill: { target: 2, above: pnlFill, below: 'rgba(240,84,110,0.08)' }, tension: .3 },
        { label: 'Entry', data: pnlPath.map((_, i) => i === 0 ? 0 : null), pointRadius: pnlPath.map((_, i) => i === 0 ? 6 : 0), pointBackgroundColor: '#7c6af7', showLine: false },
        { label: 'Exit', data: pnlPath.map((v, i) => i === pnlPath.length - 1 ? v : null), pointRadius: pnlPath.map((_, i) => i === pnlPath.length - 1 ? 6 : 0), pointBackgroundColor: pnlColor, showLine: false },
        { label: 'Best Exit', data: pnlPath.map(v => Math.abs(v - mfe) < Math.abs(mfe) * .03 ? v : null), pointRadius: pnlPath.map(v => Math.abs(v - mfe) < Math.abs(mfe) * .03 ? 5 : 0), pointBackgroundColor: 'rgba(247,168,106,1)', pointStyle: 'triangle', showLine: false },
      ]
    },
    options: { responsive: true, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 10 }, padding: 10, filter: item => ['P&L Path', 'MFE', 'MAE', 'Best Exit'].includes(item.text) } }, tooltip: { callbacks: { label: c => c.dataset.label + ': ' + fU(c.parsed.y) } } }, scales: { y: { grid: { color: '#1e1e2e' }, ticks: { callback: v => fU(v) } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } } } }
  })
  return <canvas ref={ref} height={90} />
}
