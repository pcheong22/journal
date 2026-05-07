import { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'
import { computeStats } from '../lib/tradeUtils'
import dynamic from 'next/dynamic'

// Dynamically import chart components (no SSR)
const ChartComp = dynamic(() => import('../components/Charts'), { ssr: false })
const TradeModal = dynamic(() => import('../components/TradeModal'), { ssr: false })

const fU = (n, d = 0) => (n >= 0 ? '+' : '') + n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: d })
const fA = n => '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })

const SESSION_TIMES = { Asia: '23:00–07:00 GMT', London: '07:00–12:00 GMT', 'London/NY Overlap': '12:00–16:00 GMT', 'New York': '16:00–22:00 GMT' }
const SESSION_COLORS = { Asia: 'rgba(93,214,200,.08)', London: 'rgba(124,106,247,.08)', 'London/NY Overlap': 'rgba(247,168,106,.08)', 'New York': 'rgba(78,203,141,.08)' }
const SESSION_BORDERS = { Asia: 'rgba(93,214,200,.25)', London: 'rgba(124,106,247,.25)', 'London/NY Overlap': 'rgba(247,168,106,.25)', 'New York': 'rgba(78,203,141,.25)' }
const SESSION_TEXT = { Asia: '#5dd6c8', London: '#7c6af7', 'London/NY Overlap': '#f7a86a', 'New York': '#4ecb8d' }

export default function Dashboard() {
  const [tab, setTab] = useState('overview')
  const [trades, setTrades] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploadState, setUploadState] = useState({ status: 'idle', message: '', imported: 0, duplicates: 0 })
  const [dragOver, setDragOver] = useState(false)
  const [selectedTrade, setSelectedTrade] = useState(null)
  const [timingTab, setTimingTab] = useState('sessions')

  // Trade log state
  const [filtered, setFiltered] = useState([])
  const [page, setPage] = useState(0)
  const [sortKey, setSortKey] = useState('entry_time')
  const [sortDir, setSortDir] = useState(-1)
  const [filterSym, setFilterSym] = useState('')
  const [filterDir, setFilterDir] = useState('')
  const [filterRes, setFilterRes] = useState('')
  const [filterSess, setFilterSess] = useState('')
  const [searchQ, setSearchQ] = useState('')
  const PAGE_SIZE = 50

  // Calendar state
  const [calYear, setCalYear] = useState(new Date().getFullYear())
  const [calMonth, setCalMonth] = useState(new Date().getMonth())

  const fileInputRef = useRef()

  // Load trades from API
  const loadTrades = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/trades')
      const data = await res.json()
      if (data.trades) {
        setTrades(data.trades)
        setStats(computeStats(data.trades))
        // Set calendar to most recent trading month
        if (data.trades.length > 0) {
          const latest = data.trades.reduce((a, b) => a.entry_time > b.entry_time ? a : b)
          const d = new Date(latest.entry_time)
          setCalYear(d.getUTCFullYear())
          setCalMonth(d.getUTCMonth())
        }
      }
    } catch (e) {
      console.error('Load error:', e)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadTrades() }, [loadTrades])

  // Apply filters to trade log
  useEffect(() => {
    let f = [...trades]
    if (filterSym) f = f.filter(t => t.symbol === filterSym)
    if (filterDir) f = f.filter(t => t.direction === filterDir)
    if (filterRes === 'win') f = f.filter(t => t.pnl > 0)
    if (filterRes === 'loss') f = f.filter(t => t.pnl < 0)
    if (filterSess) f = f.filter(t => t.session === filterSess)
    if (searchQ) f = f.filter(t => (t.symbol + t.direction + t.session + t.entry_time).toLowerCase().includes(searchQ.toLowerCase()))
    f.sort((a, b) => {
      const av = a[sortKey] ?? '', bv = b[sortKey] ?? ''
      return sortDir * (av > bv ? 1 : -1)
    })
    setFiltered(f)
    setPage(0)
  }, [trades, filterSym, filterDir, filterRes, filterSess, searchQ, sortKey, sortDir])

  // Upload handler
  const handleFile = async file => {
    if (!file) return
    setUploadState({ status: 'uploading', message: `Parsing ${file.name}…`, imported: 0, duplicates: 0 })
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setUploadState({ status: 'success', message: data.message, imported: data.imported, duplicates: data.duplicates })
      if (data.imported > 0) await loadTrades()
    } catch (e) {
      setUploadState({ status: 'error', message: e.message, imported: 0, duplicates: 0 })
    }
  }

  const handleDrop = e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]) }
  const handleClear = async () => {
    if (!confirm('Delete ALL trade data? This cannot be undone.')) return
    await fetch('/api/clear', { method: 'DELETE' })
    setTrades([]); setStats(null)
    setUploadState({ status: 'idle', message: 'All data cleared.', imported: 0, duplicates: 0 })
  }

  const symbols = [...new Set(trades.map(t => t.symbol))].sort()
  const paginatedTrades = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // Calendar rendering
  const renderCalendar = () => {
    if (!stats) return null
    const calMap = {}
    stats.calendar.forEach(d => { calMap[d.date] = d })
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']
    const first = new Date(Date.UTC(calYear, calMonth, 1)).getDay()
    const shift = first === 0 ? 6 : first - 1
    const daysInMonth = new Date(Date.UTC(calYear, calMonth + 1, 0)).getDate()
    let mPnl = 0, mTrades = 0, mWins = 0, mDays = 0
    const cells = []
    for (let i = 0; i < shift; i++) cells.push(<div key={`e${i}`} className="cal-cell empty" />)
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const info = calMap[ds]
      if (info) { mPnl += info.total_pnl; mTrades += info.count; mWins += info.win_rate * info.count; mDays++ }
      cells.push(
        <div key={d} className={`cal-cell ${info ? (info.total_pnl >= 0 ? 'win-day' : 'loss-day') : ''}`}>
          <div style={{ fontSize: 9, color: 'var(--mu)', fontFamily: 'DM Mono,monospace' }}>{d}</div>
          {info && <>
            <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 11, fontWeight: 700, color: info.total_pnl >= 0 ? 'var(--wn)' : 'var(--ls)' }}>
              {(info.total_pnl >= 0 ? '+' : '-') + fA(info.total_pnl)}
            </div>
            <div style={{ fontSize: 9, color: 'var(--mu)' }}>{info.count}t</div>
          </>}
        </div>
      )
    }
    const mwr = mTrades > 0 ? ((mWins / mTrades) * 100).toFixed(1) : '—'
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <button className="btn" onClick={() => { let m = calMonth - 1, y = calYear; if (m < 0) { m = 11; y-- } setCalMonth(m); setCalYear(y) }}>←</button>
          <div style={{ flex: 1, textAlign: 'center', fontFamily: 'Syne,sans-serif', fontWeight: 700, fontSize: 15 }}>{monthNames[calMonth]} {calYear}</div>
          <button className="btn" onClick={() => { let m = calMonth + 1, y = calYear; if (m > 11) { m = 0; y++ } setCalMonth(m); setCalYear(y) }}>→</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3, marginBottom: 3 }}>
          {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <div key={d} style={{ textAlign: 'center', fontSize: 10, color: 'var(--mu)', fontFamily: 'DM Mono,monospace', padding: '3px 0' }}>{d}</div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3 }}>{cells}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {[['Month P&L', mDays ? (mPnl >= 0 ? '+' : '-') + fA(mPnl) : 'No data', mPnl >= 0 ? 'var(--wn)' : 'var(--ls)'],
            ['Trading Days', mDays, 'var(--tx)'], ['Trades', mTrades, 'var(--tx)'],
            ['Win Rate', mTrades ? mwr + '%' : '—', 'var(--ac)']].map(([l, v, c]) => (
            <div key={l} style={{ flex: 1, minWidth: 80, background: 'var(--sf2)', borderRadius: 8, padding: '9px 12px' }}>
              <div style={{ fontSize: 10, color: 'var(--mu)', fontFamily: 'DM Mono,monospace', textTransform: 'uppercase', marginBottom: 2 }}>{l}</div>
              <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 15, fontWeight: 700, color: c }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
      <div style={{ width: 36, height: 36, border: '3px solid var(--bd)', borderTop: '3px solid var(--ac)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      <div style={{ color: 'var(--mu)', fontFamily: 'DM Mono,monospace', fontSize: 13 }}>Loading your trades…</div>
    </div>
  )

  const ov = stats?.overview

  return (
    <>
      <Head>
        <title>Trading Journal · Performance Intelligence</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@300;400;500&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet" />
      </Head>

      {/* HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 26px', borderBottom: '1px solid var(--bd)', background: 'rgba(9,9,15,.94)', backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 200 }}>
        <div style={{ fontFamily: 'Syne,sans-serif', fontWeight: 800, fontSize: 17, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, background: 'linear-gradient(135deg,#7c6af7,#5dd6c8)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📊</div>
          Trading Journal <span style={{ color: 'var(--mu)', fontWeight: 400, fontSize: 13 }}>· Performance Intelligence</span>
        </div>
        <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 11, color: 'var(--mu)', textAlign: 'right' }}>
          {ov ? (<>
            <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--wn)', marginRight: 5, animation: 'pulse 2s infinite' }} />
            {ov.total_trades.toLocaleString()} trades<br />
            Total P&L: <strong style={{ color: 'var(--wn)' }}>{fU(Math.round(ov.total_pnl))}</strong>
          </>) : <span>No trades yet — upload a file below</span>}
        </div>
      </div>

      {/* UPLOAD BANNER */}
      <div style={{ background: 'var(--sf2)', borderBottom: '1px solid var(--bd)', padding: '10px 26px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div
          className={`drop-zone ${dragOver ? 'dragover' : ''}`}
          style={{ flex: 1, minWidth: 260, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <span style={{ fontSize: 20 }}>📁</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, fontFamily: 'Syne,sans-serif' }}>Upload trade history</div>
            <div style={{ fontSize: 11, color: 'var(--mu)' }}>Drop Excel/CSV or click — duplicates auto-skipped</div>
          </div>
        </div>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />

        {uploadState.status !== 'idle' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 8, fontSize: 12,
            background: uploadState.status === 'success' ? 'rgba(78,203,141,.1)' : uploadState.status === 'error' ? 'rgba(240,84,110,.1)' : 'rgba(124,106,247,.1)',
            color: uploadState.status === 'success' ? 'var(--wn)' : uploadState.status === 'error' ? 'var(--ls)' : 'var(--ac)',
            border: `1px solid ${uploadState.status === 'success' ? 'rgba(78,203,141,.3)' : uploadState.status === 'error' ? 'rgba(240,84,110,.3)' : 'rgba(124,106,247,.3)'}`,
            fontFamily: 'DM Mono,monospace'
          }}>
            {uploadState.status === 'uploading' && <div style={{ width: 12, height: 12, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />}
            <span>{uploadState.message}</span>
            {uploadState.duplicates > 0 && <span style={{ opacity: .7 }}>· {uploadState.duplicates} dupes skipped</span>}
          </div>
        )}

        {trades.length > 0 && (
          <button className="btn btn-danger" style={{ fontSize: 11, padding: '6px 12px' }} onClick={handleClear}>
            🗑 Clear all data
          </button>
        )}
      </div>

      {/* NAV */}
      <div style={{ display: 'flex', gap: 3, padding: '12px 26px 0', borderBottom: '1px solid var(--bd)', overflowX: 'auto', background: 'var(--bg)' }}>
        {[['overview','📈 Overview'],['coach','🧠 Coach'],['calendar','📅 Calendar'],['symbols','🎯 Symbols'],['timing','⏱ Timing'],['trades','📋 Trade Log']].map(([id, label]) => (
          <div key={id} className={`nav-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</div>
        ))}
      </div>

      {/* MAIN */}
      <div style={{ padding: '20px 26px', maxWidth: 1440, margin: '0 auto' }}>

        {/* ═══ OVERVIEW ═══ */}
        {tab === 'overview' && stats && (
          <div className="animate-fadeIn">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 9, marginBottom: 16 }}>
              {[
                ['Total P&L', fU(Math.round(ov.total_pnl)), ov.total_pnl >= 0 ? 'var(--wn)' : 'var(--ls)', 'Net realised'],
                ['Win Rate', (ov.win_rate * 100).toFixed(1) + '%', 'var(--ac)', `${Math.round(ov.win_rate * ov.total_trades)} wins / ${Math.round((1 - ov.win_rate) * ov.total_trades)} losses`],
                ['Risk/Reward', ov.avg_loss ? Math.abs(ov.avg_win / ov.avg_loss).toFixed(2) + '×' : '—', 'var(--wa)', `Avg win ${fA(ov.avg_win)} · avg loss ${fA(ov.avg_loss)}`],
                ['Best Trade', fU(Math.round(ov.best_trade)), 'var(--wn)', 'Single trade'],
                ['Worst Trade', fU(Math.round(ov.worst_trade)), 'var(--ls)', 'Single trade'],
                ['Long P&L', fU(Math.round(ov.long_pnl)), 'var(--wn)', `${(ov.long_wr * 100).toFixed(1)}% WR · ${ov.long_count} trades`],
                ['Short P&L', fU(Math.round(ov.short_pnl)), ov.short_pnl >= 0 ? 'var(--a2)' : 'var(--ls)', `${(ov.short_wr * 100).toFixed(1)}% WR · ${ov.short_count} trades`],
                ['Total Trades', ov.total_trades.toLocaleString(), 'var(--tx)', 'Across all instruments'],
              ].map(([l, v, c, s]) => (
                <div key={l} className="kpi-card">
                  <div style={{ fontSize: 10, color: 'var(--mu)', fontFamily: 'DM Mono,monospace', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 5 }}>{l}</div>
                  <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 20, fontWeight: 700, color: c }}>{v}</div>
                  <div style={{ fontSize: 10, color: 'var(--mu)', marginTop: 2 }}>{s}</div>
                </div>
              ))}
            </div>
            <ChartComp type="equity" data={stats.cumulative} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <ChartComp type="monthly" data={stats.monthly} />
              <ChartComp type="duration" data={stats.duration} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <ChartComp type="direction" longPnl={ov.long_pnl} shortPnl={ov.short_pnl} />
              <ChartComp type="distribution" trades={trades} />
            </div>
          </div>
        )}

        {/* ═══ COACH ═══ */}
        {tab === 'coach' && (
          <div className="animate-fadeIn">
            <div style={{ background: 'linear-gradient(135deg,rgba(124,106,247,.1),rgba(93,214,200,.04))', border: '1px solid rgba(124,106,247,.2)', borderRadius: 16, padding: '20px 24px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 20, fontWeight: 800, marginBottom: 4 }}>Your Trading Coach Report</div>
                <div style={{ fontSize: 13, color: 'var(--mu)', maxWidth: 540, lineHeight: 1.7 }}>Analysis of {ov?.total_trades?.toLocaleString() || 0} trades. Key patterns, recurring errors, and highest-leverage changes identified below.</div>
              </div>
              <div style={{ textAlign: 'center', flexShrink: 0 }}>
                <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 50, fontWeight: 800, color: 'var(--ac)', lineHeight: 1 }}>62</div>
                <div style={{ fontSize: 10, color: 'var(--mu)', fontFamily: 'DM Mono,monospace', textTransform: 'uppercase' }}>Consistency Score</div>
              </div>
            </div>
            <CoachInsights />
          </div>
        )}

        {/* ═══ CALENDAR ═══ */}
        {tab === 'calendar' && (
          <div className="animate-fadeIn">
            <div className="card">{renderCalendar()}</div>
          </div>
        )}

        {/* ═══ SYMBOLS ═══ */}
        {tab === 'symbols' && stats && (
          <div className="animate-fadeIn">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <ChartComp type="symbolPnl" data={stats.symbols.slice(0, 14)} />
              <ChartComp type="symbolWr" data={stats.symbols.slice(0, 14)} />
            </div>
            <div className="card">
              <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 11, fontWeight: 700, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 12 }}>Full Symbol Breakdown</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ minWidth: 560 }}>
                  <thead><tr>
                    {['Symbol','Trades','Total P&L','Win Rate','Avg P&L','Avg Notional','Assessment'].map(h => <th key={h}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {stats.symbols.map(s => {
                      const wr = Math.round(s.win_rate * 100)
                      const badge = s.total_pnl > 10000 && s.win_rate > .65 ? <span className="badge-win">KEEP</span>
                        : s.total_pnl < -10000 ? <span className="badge-loss">REDUCE</span>
                        : <span style={{ background: 'rgba(255,255,255,.04)', color: 'var(--mu)', padding: '2px 7px', borderRadius: 10, fontSize: 10 }}>MONITOR</span>
                      return (
                        <tr key={s.symbol}>
                          <td style={{ fontFamily: 'Syne,sans-serif', fontWeight: 600 }}>{s.symbol}</td>
                          <td>{s.count}</td>
                          <td style={{ color: s.total_pnl >= 0 ? 'var(--wn)' : 'var(--ls)' }}>{fU(Math.round(s.total_pnl))}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ width: 50, background: 'var(--sf2)', borderRadius: 2, height: 4 }}>
                                <div style={{ width: wr + '%', height: 4, borderRadius: 2, background: wr >= 65 ? 'var(--wn)' : wr < 50 ? 'var(--ls)' : 'var(--wa)' }} />
                              </div>
                              {wr}%
                            </div>
                          </td>
                          <td style={{ color: s.avg_pnl >= 0 ? 'var(--wn)' : 'var(--ls)' }}>{fU(Math.round(s.avg_pnl))}</td>
                          <td style={{ color: 'var(--mu)' }}>${((s.avg_notional || 0) / 1e6).toFixed(2)}M</td>
                          <td>{badge}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ═══ TIMING ═══ */}
        {tab === 'timing' && stats && (
          <div className="animate-fadeIn">
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              {[['sessions','Trading Sessions'],['dow','Day of Week'],['hourly','Hour of Day']].map(([id, label]) => (
                <div key={id} style={{ padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid', fontFamily: 'Syne,sans-serif', transition: 'all .15s', borderColor: timingTab === id ? 'var(--ac)' : 'var(--bd)', background: timingTab === id ? 'var(--ac)' : 'transparent', color: timingTab === id ? '#fff' : 'var(--mu)' }} onClick={() => setTimingTab(id)}>{label}</div>
              ))}
            </div>

            {timingTab === 'sessions' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, marginBottom: 12 }}>
                  {stats.sessions.filter(s => s.session !== 'Other').map(s => (
                    <div key={s.session} style={{ padding: 14, background: SESSION_COLORS[s.session] || 'var(--sf2)', border: `1px solid ${SESSION_BORDERS[s.session] || 'var(--bd)'}`, borderRadius: 10 }}>
                      <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{s.session}</div>
                      <div style={{ fontSize: 10, color: 'var(--mu)', fontFamily: 'DM Mono,monospace', marginBottom: 6 }}>{SESSION_TIMES[s.session] || ''}</div>
                      <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 18, fontWeight: 700, color: s.win_rate >= .65 ? 'var(--wn)' : s.win_rate >= .55 ? 'var(--wa)' : 'var(--ls)' }}>{(s.win_rate * 100).toFixed(1)}% WR</div>
                      <div style={{ fontSize: 11, color: 'var(--mu)', marginTop: 2 }}>{fU(Math.round(s.total_pnl))} · {s.count} trades</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <ChartComp type="sessionPnl" data={stats.sessions.filter(s => s.session !== 'Other')} />
                  <ChartComp type="sessionWr" data={stats.sessions.filter(s => s.session !== 'Other')} />
                </div>
              </>
            )}

            {timingTab === 'dow' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <ChartComp type="dowPnl" data={stats.daily_dow} />
                  <ChartComp type="dowWr" data={stats.daily_dow} />
                </div>
                <div className="card">
                  <div style={{ overflowX: 'auto' }}>
                    <table className="data-table" style={{ minWidth: 400 }}>
                      <thead><tr>{['Day','Trades','Total P&L','Win Rate','Avg P&L'].map(h => <th key={h}>{h}</th>)}</tr></thead>
                      <tbody>
                        {stats.daily_dow.map(d => (
                          <tr key={d.day_of_week}>
                            <td style={{ fontFamily: 'Syne,sans-serif', fontWeight: 600 }}>{d.day_of_week}</td>
                            <td>{d.count}</td>
                            <td style={{ color: d.total_pnl >= 0 ? 'var(--wn)' : 'var(--ls)' }}>{fU(Math.round(d.total_pnl))}</td>
                            <td style={{ color: d.win_rate >= .65 ? 'var(--wn)' : d.win_rate < .55 ? 'var(--ls)' : 'var(--wa)' }}>{(d.win_rate * 100).toFixed(1)}%</td>
                            <td style={{ color: d.avg_pnl >= 0 ? 'var(--wn)' : 'var(--ls)' }}>{fU(Math.round(d.avg_pnl))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {timingTab === 'hourly' && (
              <>
                <ChartComp type="hourly" data={stats.hourly} />
              </>
            )}
          </div>
        )}

        {/* ═══ TRADE LOG ═══ */}
        {tab === 'trades' && (
          <div className="animate-fadeIn">
            <div style={{ fontSize: 12, color: 'var(--mu)', marginBottom: 10, fontFamily: 'DM Mono,monospace' }}>Click any row to open detailed analysis with TradingView chart and P&L path</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
              <input className="input-field" style={{ width: 180 }} placeholder="Search…" value={searchQ} onChange={e => setSearchQ(e.target.value)} />
              <select className="input-field" value={filterSym} onChange={e => setFilterSym(e.target.value)}>
                <option value="">All Symbols</option>
                {symbols.map(s => <option key={s}>{s}</option>)}
              </select>
              <select className="input-field" value={filterDir} onChange={e => setFilterDir(e.target.value)}>
                <option value="">Long & Short</option>
                <option>Long</option><option>Short</option>
              </select>
              <select className="input-field" value={filterRes} onChange={e => setFilterRes(e.target.value)}>
                <option value="">Win & Loss</option>
                <option value="win">Win</option><option value="loss">Loss</option>
              </select>
              <select className="input-field" value={filterSess} onChange={e => setFilterSess(e.target.value)}>
                <option value="">All Sessions</option>
                <option>Asia</option><option>London</option><option>London/NY Overlap</option><option>New York</option>
              </select>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--mu)', fontFamily: 'DM Mono,monospace' }}>{filtered.length.toLocaleString()} trades</span>
            </div>
            <div className="card">
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ minWidth: 920 }}>
                  <thead><tr>
                    {[['entry_time','Entry'],['symbol','Symbol'],['direction','Dir'],['entry_price','Entry Px'],['exit_price','Exit Px'],['notional_usd','Notional USD'],['pnl','P&L'],['pct_gain','% Return'],['duration_mins','Duration'],['session','Session'],['result','Result']].map(([k, l]) => (
                      <th key={k} onClick={() => { if (k !== 'direction' && k !== 'session' && k !== 'result') { setSortKey(k); setSortDir(sortKey === k ? -sortDir : -1) } }} style={{ cursor: k !== 'direction' && k !== 'session' && k !== 'result' ? 'pointer' : 'default', color: sortKey === k ? 'var(--ac)' : '' }}>{l} {sortKey === k ? (sortDir < 0 ? '↓' : '↑') : ''}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {paginatedTrades.map((t, i) => {
                      const pc = t.pnl >= 0 ? 'var(--wn)' : 'var(--ls)'
                      const pct = t.pct_gain != null ? (t.pct_gain >= 0 ? '+' : '') + t.pct_gain.toFixed(3) + '%' : '—'
                      const not = t.notional_usd ? '$' + Math.round(t.notional_usd).toLocaleString() : '—'
                      const durH = t.duration_mins ? (t.duration_mins / 60).toFixed(1) + 'h' : '—'
                      const tradeIdx = trades.indexOf(t)
                      return (
                        <tr key={t.id || i} className="clickable" onClick={() => setSelectedTrade(t)}>
                          <td style={{ color: 'var(--mu)' }}>{t.entry_time?.slice(0, 16).replace('T', ' ')}</td>
                          <td style={{ fontFamily: 'Syne,sans-serif', fontWeight: 600 }}>{t.symbol}</td>
                          <td><span className={t.direction === 'Long' ? 'badge-long' : 'badge-short'}>{t.direction}</span></td>
                          <td>{t.entry_price?.toLocaleString() || '—'}</td>
                          <td>{t.exit_price?.toLocaleString() || '—'}</td>
                          <td style={{ color: 'var(--mu)' }}>{not}</td>
                          <td style={{ color: pc }}>{fU(t.pnl)}</td>
                          <td style={{ color: t.pct_gain >= 0 ? 'var(--wn)' : 'var(--ls)' }}>{pct}</td>
                          <td style={{ color: 'var(--mu)' }}>{durH}</td>
                          <td><span style={{ padding: '2px 6px', borderRadius: 10, fontSize: 10, background: SESSION_COLORS[t.session] || 'rgba(255,255,255,.04)', color: SESSION_TEXT[t.session] || 'var(--mu)' }}>{t.session}</span></td>
                          <td><span className={t.pnl >= 0 ? 'badge-win' : 'badge-loss'}>{t.pnl >= 0 ? 'WIN' : 'LOSS'}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10 }}>
                <button className="btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
                <span style={{ fontSize: 11, color: 'var(--mu)', fontFamily: 'DM Mono,monospace' }}>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
                <button className="btn" disabled={(page + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage(p => p + 1)}>Next →</button>
              </div>
            </div>
          </div>
        )}

        {/* No data state */}
        {!loading && trades.length === 0 && tab !== 'coach' && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--mu)' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
            <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 18, fontWeight: 700, marginBottom: 8, color: 'var(--tx)' }}>No trades yet</div>
            <div style={{ fontSize: 13 }}>Upload your broker export using the bar above to get started.</div>
          </div>
        )}
      </div>

      {/* TRADE DETAIL MODAL */}
      {selectedTrade && <TradeModal trade={selectedTrade} onClose={() => setSelectedTrade(null)} trades={trades} onNavigate={setSelectedTrade} />}
    </>
  )
}

function CoachInsights() {
  const insights = [
    { type: 'critical', badge: '⚠ Critical #1', title: 'Inverted Risk:Reward', body: 'Win rate 67.9% is excellent but losses dwarf wins. Avg win +$2,256 vs avg loss -$3,650. R:R = 0.62×. Every 3 losses wipe ~5 wins.', action: 'Hard 1.0× R:R minimum before any entry. If target < stop, skip the trade.' },
    { type: 'critical', badge: '⚠ Critical #2', title: 'Letting Losers Run', body: 'Losing trades held 2× longer on average (1,005 vs 496 min). Trades >24hr: WR only 51%, cost -$179,530.', action: 'Max 24-hr hold on any losing position. Never hold a loss overnight a second time.' },
    { type: 'critical', badge: '⚠ Critical #3', title: 'XAG/USD Catastrophic Sizing', body: 'SILVER WR 83% (+$365k) but XAG/USD lost -$24k via one -$65,356 trade on 31 Oct 2024. Same underlying, no size control.', action: 'Treat SILVER + XAG/USD as one instrument. Daily max loss per instrument: 5% of account.' },
    { type: 'critical', badge: '⚠ Critical #4', title: 'EUR50, GER30, JAPAN — No Edge', body: 'EUR50 40% WR -$60k · GER30 46% WR -$38k · JAPAN 41% WR -$31k. Combined -$129k on 198 trades.', action: 'Remove all three from watchlist entirely. Capital is better deployed in SILVER/HK-HSI.' },
    { type: 'bias', badge: '⚡ Bias #1', title: 'Severe Revenge Trading', body: 'After a win: 89.9% WR. After a loss: 20.6% WR. A 69 percentage-point collapse. Classic reactive re-entry after losses.', action: 'Mandatory 30-min cooling-off after any loss before next entry. Make it non-negotiable.' },
    { type: 'bias', badge: '⚡ Bias #2', title: 'Thursday Collapse', body: 'Mon–Wed: 66–76% WR, all profitable. Thursday: 52.8% WR, -$26,681. Friday: 74.2% WR, +$209k.', action: 'Half position size on Thursdays. Track correlation with economic event calendar.' },
    { type: 'opportunity', badge: '💡 Opportunity', title: 'HK-HSI: Most Consistent Instrument', body: '91.6% WR, +$130k across 143 trades. Never a catastrophic loss. Only 10% of trades allocated here vs 33% to NASDAQ near breakeven.', action: 'Double HK-HSI allocation. Asian open 01:00–04:00 GMT peaks at 93–96% WR.' },
    { type: 'strength', badge: '✅ Strength', title: 'SILVER Long Edge is Elite', body: '83.2% WR, +$365k, avg win $5,733. Multiple $19k–$24k winners in 2025. Deep intuition for silver momentum.', action: 'Document top 20 SILVER trade entries into a playbook and apply that discipline to every entry.' },
  ]
  const typeColors = { critical: { border: 'rgba(240,84,110,.3)', grad: 'var(--ls)', badge: 'rgba(240,84,110,.12)', text: 'var(--ls)' }, bias: { border: 'rgba(247,168,106,.3)', grad: 'var(--a3)', badge: 'rgba(247,168,106,.12)', text: 'var(--a3)' }, opportunity: { border: 'rgba(93,214,200,.3)', grad: 'var(--a2)', badge: 'rgba(93,214,200,.12)', text: 'var(--a2)' }, strength: { border: 'rgba(78,203,141,.3)', grad: 'var(--wn)', badge: 'rgba(78,203,141,.12)', text: 'var(--wn)' } }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {insights.map((ins, i) => {
        const c = typeColors[ins.type]
        return (
          <div key={i} className="insight-card" style={{ borderColor: c.border, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,${c.grad},transparent)` }} />
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 20, fontSize: 10, fontFamily: 'DM Mono,monospace', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8, background: c.badge, color: c.text }}>{ins.badge}</div>
            <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 14, fontWeight: 700, marginBottom: 5 }}>{ins.title}</div>
            <div style={{ fontSize: 12, color: '#b0b0c8', lineHeight: 1.65 }}>{ins.body}</div>
            <div style={{ marginTop: 9, padding: '9px 11px', background: 'rgba(124,106,247,.08)', borderLeft: '3px solid var(--ac)', borderRadius: '0 6px 6px 0', fontSize: 11, color: 'var(--tx)', lineHeight: 1.6 }}><strong style={{ color: 'var(--ac)' }}>Action:</strong> {ins.action}</div>
          </div>
        )
      })}
    </div>
  )
}
