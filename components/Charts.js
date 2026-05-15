import { useEffect, useRef } from 'react'
import Chart from 'chart.js/auto'

// ── COMMON CHART OPTIONS ─────────────────────────────────────────────────────
const LEGEND = { display: false }
const GRID = { color: 'rgba(48, 54, 61, 0.5)' }
const TICK = { color: '#8b949e', font: { size: 10, family: 'JetBrains Mono' } }

// ── BAR CHART (Monthly P&L) ──────────────────────────────────────────────────
export function BarCard({ title, labels, values, height = 130 }) {
  const canvasRef = useRef()
  
  useEffect(() => {
    if (!canvasRef.current) return
    
    const ctx = canvasRef.current.getContext('2d')
    
    // Filter out 'Unknown' labels
    const filteredLabels = labels.filter((l, i) => l && l !== 'Unknown' && values[i] !== undefined)
    const filteredValues = values.filter((v, i) => labels[i] && labels[i] !== 'Unknown' && v !== undefined)
    
    const chart = new Chart(ctx, {
      type: 'bar',
      data: {  // 👈 FIXED: Added 'data:' key
        labels: filteredLabels,
        datasets: [{
          data: filteredValues,  // 👈 FIXED: Added 'data:' key
          backgroundColor: filteredValues.map(v => v >= 0 ? 'rgba(75, 222, 128, 0.6)' : 'rgba(185, 65, 68, 0.6)'),
          borderColor: filteredValues.map(v => v >= 0 ? '#4bde80' : '#b94144'),
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: LEGEND },
        scales: {
          y: {
            grid: GRID,
            ticks: { ...TICK, callback: v => '$' + Math.round(v / 1000) + 'k' }
          },
          x: {
            grid: { display: false },
            ticks: { ...TICK, maxRotation: 45, minRotation: 45 }
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

// ── LINE CHART (Equity Curve) ─────────────────────────────────────────────────
export function EquityChart({ data, privacyMode }) {
  const canvasRef = useRef()
  
  useEffect(() => {
    if (!canvasRef.current || !data?.length) return
    
    const ctx = canvasRef.current.getContext('2d')
    const vals = data.map(d => d.cum_pnl || 0)
    
    const chart = new Chart(ctx, {
      type: 'line',
      data: {  // 👈 FIXED: Added 'data:' key
        labels: data.map(d => d.date),
        datasets: [{
          data: vals,  // 👈 FIXED: Added 'data:' key
          borderColor: '#4bde80',
          backgroundColor: 'rgba(75, 222, 128, 0.1)',
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: LEGEND,
          tooltip: {
            backgroundColor: '#161b22',
            titleColor: '#e6edf3',
            bodyColor: '#8b949e',
            borderColor: '#30363d',
            borderWidth: 1,
            callbacks: {
              label: ctx => {
                if (privacyMode) return '******'
                const val = ctx.parsed.y
                return '$' + Math.round(val).toLocaleString()
              }
            }
          }
        },
        scales: {
          y: {
            grid: GRID,
            ticks: {
              ...TICK,
              callback: v => privacyMode ? '******' : '$' + Math.round(v / 1000) + 'k'
            }
          },
          x: {
            grid: { display: false },
            ticks: { ...TICK, maxTicksLimit: 8, maxRotation: 0 }
          }
        }
      }
    })
    
    return () => chart.destroy()
  }, [data, privacyMode])
  
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="card-title">
        <span className="indicator" />
        EQUITY CURVE
      </div>
      <canvas ref={canvasRef} height={140} />
    </div>
  )
}

// ── CHART COMPONENT WRAPPER ──────────────────────────────────────────────────
export default function ChartComp({ type, ...props }) {
  if (type === 'equity') return <EquityChart {...props} />
  if (type === 'monthly') return <BarCard {...props} />
  return null
}
