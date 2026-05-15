import { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'
import { computeStats } from '../lib/tradeUtils'
import dynamic from 'next/dynamic'

const ChartComp  = dynamic(() => import('../components/Charts'),     { ssr: false })
const TradeModal = dynamic(() => import('../components/TradeModal'), { ssr: false })

const fU   = (n, d=0) => (n>=0?'+':'')+n.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:d,maximumFractionDigits:d})
const fA   = n => '$'+Math.abs(n).toLocaleString('en-US',{maximumFractionDigits:0})
const fPct = (n, d=1) => (n>=0?'+':'')+n.toFixed(d)+'%'

const SESSION_TIMES = { Asia:'23:00–07:00 GMT', London:'07:00–12:00 GMT', 'London/NY Overlap':'12:00–16:00 GMT', 'New York':'16:00–22:00 GMT' }
const SESSION_CLASS = { Asia:'pill-asia', London:'pill-london', 'London/NY Overlap':'pill-overlap', 'New York':'pill-ny' }
const BROKER_ICONS  = { PrimeXBT:'🔷', Generic:'📊' }
const BROKER_COLORS = ['#1a56db','#059669','#d97706','#7c3aed','#dc2626','#0891b2','#be185d','#16a34a']

// Date range helpers
const toISO  = d => d.toISOString().slice(0, 10)
const ytdStart = () => `${new Date().getUTCFullYear()}-01-01`
const today    = () => toISO(new Date())
const daysAgo  = n => { const d = new Date(); d.setDate(d.getDate() - n); return toISO(d) }
const monthsAgo = n => { const d = new Date(); d.setMonth(d.getMonth() - n); return toISO(d) }

const DATE_PRESETS = [
  { label: '7D',  from: () => daysAgo(7),   to: today },
  { label: '30D', from: () => daysAgo(30),  to: today },
  { label: '3M',  from: () => monthsAgo(3), to: today },
  { label: '6M',  from: () => monthsAgo(6), to: today },
  { label: 'YTD', from: ytdStart,            to: today },
  { label: '1Y',  from: () => monthsAgo(12),to: today },
  { label: 'All', from: () => '2000-01-01', to: today },
]

export default function Dashboard() {
  // Core state
  const [tab,         setTab]         = useState('overview')
  const [allTrades,   setAllTrades]   = useState([])
  const [accounts,    setAccounts]    = useState([])
  const [tags,        setTags]        = useState([])
  const [stats,       setStats]       = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [upload,      setUpload]      = useState({ status:'idle', message:'', broker:'', accountId:'' })
  const [dragOver,    setDragOver]    = useState(false)
  const [selected,    setSelected]    = useState(null)
  const [privacy,     setPrivacy]     = useState(false)

  // Account selector
  const [selAccounts, setSelAccounts] = useState(new Set())

  // Date range
  const [datePreset,  setDatePreset]  = useState('YTD')
  const [dateFrom,    setDateFrom]    = useState(ytdStart())
  const [dateTo,      setDateTo]      = useState(today())
  const [showCustom,  setShowCustom]  = useState(false)

  // Calendar
  const [calYear,     setCalYear]     = useState(new Date().getUTCFullYear())
  const [calMonth,    setCalMonth]    = useState(new Date().getUTCMonth())

  // Trade log
  const [filtered,    setFiltered]    = useState([])
  const [page,        setPage]        = useState(0)
  const [sortKey,     setSortKey]     = useState('entry_time')
  const [sortDir,     setSortDir]     = useState(-1)
  const [fSym,        setFSym]        = useState('')
  const [fDir,        setFDir]        = useState('')
  const [fRes,        setFRes]        = useState('')
  const [fSess,       setFSess]       = useState('')
  const [search,      setSearch]      = useState('')

  // Timing sub-tab
  const [timingTab,   setTimingTab]   = useState('sessions')

  // Editing
  const [editingAccount, setEditingAccount] = useState(null)

  const [isClient,    setIsClient]    = useState(false)

  const PAGE    = 50
  const fileRef = useRef()

  // Prevent SSR crash — only render full UI on client
  useEffect(() => { setIsClient(true) }, [])

  // Privacy class toggle
  useEffect(() => {
    document.body.classList.toggle('privacy-on', privacy)
  }, [privacy])

  // Derived: trades visible given account + date selection
  const visibleTrades = allTrades.filter(t =>
    selAccounts.size === 0 || selAccounts.has(t.account_id)
  )

  // Recompute stats when visible trades change
  useEffect(() => {
    setStats(computeStats(visibleTrades))
    if (visibleTrades.length > 0) {
      const latest = visibleTrades.reduce((a,b) => a.entry_time > b.entry_time ? a : b)
      const d = new Date(latest.entry_time)
      setCalYear(d.getUTCFullYear()); setCalMonth(d.getUTCMonth())
    }
  }, [allTrades, selAccounts])

  // Filter trade log
  useEffect(() => {
    let f = [...visibleTrades]
    if (fSym)  f = f.filter(t => t.symbol    === fSym)
    if (fDir)  f = f.filter(t => t.direction === fDir)
    if (fRes === 'win')  f = f.filter(t => t.pnl > 0)
    if (fRes === 'loss') f = f.filter(t => t.pnl < 0)
    if (fSess) f = f.filter(t => t.session   === fSess)
    if (search) f = f.filter(t =>
      (t.symbol+t.direction+t.session+t.entry_time+(t.account_id||'')).toLowerCase().includes(search.toLowerCase())
    )
    f.sort((a,b) => { const av=a[sortKey]??'',bv=b[sortKey]??''; return sortDir*(av>bv?1:-1) })
    setFiltered(f); setPage(0)
  }, [allTrades, selAccounts, fSym, fDir, fRes, fSess, search, sortKey, sortDir])

  // Load trades from API with date filtering (server-side)
  const loadTrades = useCallback(async (from, to) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (from && from !== '2000-01-01') params.set('from', from + 'T00:00:00Z')
      if (to)   params.set('to',   to   + 'T23:59:59Z')
      const res  = await fetch(`/api/trades?${params}`)
      const data = await res.json()
      if (data.trades)   setAllTrades(data.trades)
      if (data.accounts) setAccounts(data.accounts)
      if (data.tags)     setTags(data.tags)
    } catch(e) { console.error(e) }
    setLoading(false)
  }, [])

  // Initial load — YTD
  useEffect(() => { loadTrades(dateFrom, dateTo) }, [])

  // Apply date preset
  const applyPreset = (preset) => {
    const p    = DATE_PRESETS.find(p => p.label === preset)
    if (!p) return
    const from = p.from()
    const to   = p.to()
    setDatePreset(preset); setDateFrom(from); setDateTo(to); setShowCustom(false)
    loadTrades(from, to)
  }

  const applyCustom = () => {
    setDatePreset(''); loadTrades(dateFrom, dateTo)
  }

  // Account toggle
  const toggleAccount = id => {
    setSelAccounts(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else              next.add(id)
      if (next.size === accounts.length) return new Set()
      return next
    })
  }
  const selectOnly = id => setSelAccounts(new Set([id]))

  // Upload
  const handleFile = async file => {
    if (!file) return
    setUpload({ status:'uploading', message:`Parsing ${file.name}…`, broker:'', accountId:'' })
    const form = new FormData(); form.append('file', file)
    try {
      const res  = await fetch('/api/upload', { method:'POST', body:form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setUpload({ status:'success', message:data.message, broker:data.broker||'', accountId:data.accountId||'' })
      if (data.imported > 0) await loadTrades(dateFrom, dateTo)
    } catch(e) {
      setUpload({ status:'error', message:e.message, broker:'', accountId:'' })
    }
  }
  const handleDrop  = e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]) }
  const handleClear = async (accountId = null) => {
    const msg = accountId ? `Delete account and all its trades?` : 'Delete ALL data for ALL accounts?'
    if (!confirm(msg + ' Cannot be undone.')) return
    await fetch(accountId ? `/api/clear?account=${accountId}` : '/api/clear', { method:'DELETE' })
    await loadTrades(dateFrom, dateTo)
    setUpload({ status:'idle', message:'', broker:'', accountId:'' })
  }

  const saveAccountLabel = async (id, label) => {
    await fetch('/api/accounts', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id, label }) })
    await loadTrades(dateFrom, dateTo)
    setEditingAccount(null)
  }

  const accountsMap = Object.fromEntries(accounts.map(a => [a.id, a]))
  const symbols     = [...new Set(visibleTrades.map(t => t.symbol))].sort()
  const paged       = filtered.slice(page*PAGE, (page+1)*PAGE)
  const ov          = stats?.overview

  // Calendar render
  const renderCalendar = () => {
    if (!stats) return null
    const calMap = {}; stats.calendar.forEach(d => { calMap[d.date] = d })
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
    const first  = new Date(Date.UTC(calYear, calMonth, 1)).getDay()
    const shift  = first===0 ? 6 : first-1
    const days   = new Date(Date.UTC(calYear, calMonth+1, 0)).getDate()
    let mPnl=0, mTrades=0, mWins=0, mDays=0
    const cells = []
    for (let i=0; i<shift; i++) cells.push(<div key={`e${i}`} className="cal-cell emp" />)
    for (let d=1; d<=days; d++) {
      const ds   = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
      const info = calMap[ds]
      if (info) { mPnl+=info.total_pnl; mTrades+=info.count; mWins+=info.win_rate*info.count; mDays++ }
      cells.push(
        <div key={d} className={`cal-cell${info?' hd '+(info.total_pnl>=0?' wd':' ld'):''}`}>
          <div style={{fontSize:9,color:'var(--mu)',fontFamily:'var(--font-mono)',marginBottom:1}}>{d}</div>
          {info && <>
            <div className="private" style={{fontFamily:'var(--font-mono)',fontSize:11,fontWeight:600,color:info.total_pnl>=0?'var(--wn-tx)':'var(--ls-tx)'}}>
              {(info.total_pnl>=0?'+':'-')+fA(info.total_pnl)}
            </div>
            <div style={{fontSize:9,color:'var(--mu)',marginTop:1}}>{info.count}t</div>
          </>}
        </div>
      )
    }
    const mwr = mTrades > 0 ? ((mWins/mTrades)*100).toFixed(1)+'%' : '—'
    const nav  = dir => { let m=calMonth+dir,y=calYear; if(m>11){m=0;y++}else if(m<0){m=11;y--}; setCalMonth(m); setCalYear(y) }
    return (<>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
        <button className="btn btn-sm" onClick={()=>nav(-1)}>←</button>
        <div style={{flex:1,textAlign:'center',fontWeight:700,fontSize:14}}>{MONTHS[calMonth]} {calYear}</div>
        <button className="btn btn-sm" onClick={()=>nav(1)}>→</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3,marginBottom:3}}>
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>(
          <div key={d} style={{textAlign:'center',fontSize:10,fontWeight:600,color:'var(--mu)',fontFamily:'var(--font-mono)',padding:'3px 0',textTransform:'uppercase',letterSpacing:'.04em'}}>{d}</div>
        ))}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3}}>{cells}</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginTop:12}}>
        {[['MONTH P&L',mDays?(mPnl>=0?'+':'-')+fA(mPnl):'No data',mPnl>=0?'var(--wn-tx)':'var(--ls-tx)'],
          ['TRADING DAYS',mDays,'var(--tx)'],['TRADES',mTrades,'var(--tx)'],['WIN RATE',mwr,'var(--ac)']].map(([l,v,c])=>(
          <div key={l} style={{background:'var(--sf2)',borderRadius:6,padding:'10px 12px',border:'1px solid var(--bd)'}}>
            <div style={{fontSize:10,fontWeight:600,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:3}}>{l}</div>
            <div className={l==='MONTH P&L'?'private':''} style={{fontFamily:'var(--font-mono)',fontSize:14,fontWeight:600,color:c}}>{v}</div>
          </div>
        ))}
      </div>
    </>)
  }

  if (!isClient || loading) return (
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:12}}>
      <div style={{width:28,height:28,border:'2px solid var(--bd2)',borderTop:'2px solid var(--ac)',borderRadius:'50%',animation:'spin 1s linear infinite'}} />
      <div style={{color:'var(--mu)',fontFamily:'var(--font-mono)',fontSize:11,letterSpacing:'.04em'}}>LOADING…</div>
    </div>
  )

  return (
    <>
      <Head>
        <title>Trading Journal · Performance Intelligence</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@300;400;500;600&display=swap" rel="stylesheet" />
      </Head>

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <header className="page-hdr">
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:28,height:28,background:'var(--ac)',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:13,fontWeight:700}}>TJ</div>
          <span style={{fontWeight:700,fontSize:13,letterSpacing:'.04em',textTransform:'uppercase'}}>Trading Journal</span>
          <span style={{color:'var(--mu)',fontSize:10,fontFamily:'var(--font-mono)',letterSpacing:'.06em',textTransform:'uppercase'}}>Performance Intelligence</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:14,fontFamily:'var(--font-mono)',fontSize:11}}>
          {ov ? (<>
            <span style={{color:'var(--mu)'}}><span style={{color:'var(--tx)',fontWeight:600}}>{ov.total_trades.toLocaleString()}</span> TRADES</span>
            <span style={{color:'var(--mu)'}}>P&L <span className="private" style={{color:ov.total_pnl>=0?'var(--wn)':'var(--ls)',fontWeight:600}}>{fU(Math.round(ov.total_pnl))}</span></span>
            <span style={{color:'var(--mu)'}}>WR <span style={{color:'var(--ac)',fontWeight:600}}>{(ov.win_rate*100).toFixed(1)}%</span></span>
          </>) : <span style={{color:'var(--mu)'}}>NO DATA</span>}
          {/* Privacy toggle */}
          <button onClick={()=>setPrivacy(p=>!p)} title={privacy ? 'Show values' : 'Hide values'}
            style={{background:privacy?'var(--ac-bg)':'var(--sf)',border:`1px solid ${privacy?'var(--ac-bd)':'var(--bd)'}`,borderRadius:6,padding:'4px 8px',cursor:'pointer',fontSize:14,transition:'all .15s'}}>
            {privacy ? '🙈' : '👁'}
          </button>
          <span style={{display:'inline-flex',alignItems:'center',gap:5,color:'var(--mu)',fontSize:10}}>
            <span style={{width:6,height:6,borderRadius:'50%',background:'var(--wn)',display:'inline-block',animation:'pulse 2s infinite'}} />LIVE
          </span>
        </div>
      </header>

      {/* ── ACCOUNT SELECTOR ───────────────────────────────────────────── */}
      {accounts.length > 0 && (
        <div style={{background:'var(--sf)',borderBottom:'1px solid var(--bd)',padding:'8px 24px',display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
          <span style={{fontSize:10,fontWeight:600,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)'}}>ACCOUNTS</span>
          <button onClick={()=>setSelAccounts(new Set())}
            style={{padding:'4px 10px',borderRadius:5,border:'1px solid',fontSize:11,fontFamily:'var(--font-mono)',cursor:'pointer',fontWeight:600,transition:'all .15s',
              background:selAccounts.size===0?'var(--ac)':'var(--sf2)',borderColor:selAccounts.size===0?'var(--ac)':'var(--bd)',color:selAccounts.size===0?'#fff':'var(--tx2)'}}>
            ALL ({allTrades.length.toLocaleString()})
          </button>
          {accounts.map(acc => {
            const isActive = selAccounts.size===0 || selAccounts.has(acc.id)
            const count    = allTrades.filter(t => t.account_id === acc.id).length
            const accPnl   = allTrades.filter(t => t.account_id === acc.id).reduce((s,t)=>s+t.pnl,0)
            return (
              <div key={acc.id} style={{display:'flex',alignItems:'center',gap:0,borderRadius:6,overflow:'hidden',border:`1px solid ${isActive&&selAccounts.size>0?acc.color:isActive?'var(--bd2)':'var(--bd)'}`,background:isActive&&selAccounts.size>0?acc.color+'18':'var(--sf2)',transition:'all .15s'}}>
                <button onClick={()=>toggleAccount(acc.id)}
                  style={{padding:'4px 10px',border:'none',background:'transparent',cursor:'pointer',display:'flex',alignItems:'center',gap:5,fontSize:11,fontFamily:'var(--font-mono)',fontWeight:500,color:isActive?'var(--tx)':'var(--mu)'}}>
                  <span style={{width:8,height:8,borderRadius:'50%',background:acc.color,flexShrink:0,opacity:isActive?1:.4}} />
                  <span style={{fontWeight:600}}>{acc.label||acc.id}</span>
                  <span style={{color:'var(--mu)',fontSize:10}}>{BROKER_ICONS[acc.broker]||'📊'}</span>
                  <span style={{color:'var(--mu)',fontSize:10}}>{count}</span>
                  <span className="private" style={{fontSize:10,color:accPnl>=0?'var(--wn)':'var(--ls)',fontWeight:600}}>{fU(Math.round(accPnl))}</span>
                </button>
                <div style={{borderLeft:'1px solid var(--bd)',display:'flex'}}>
                  <button onClick={()=>selectOnly(acc.id)} title="View only" style={{padding:'4px 7px',border:'none',background:'transparent',cursor:'pointer',fontSize:10,color:'var(--mu)'}}>⊙</button>
                  <button onClick={()=>setEditingAccount(acc)} title="Rename" style={{padding:'4px 7px',border:'none',background:'transparent',cursor:'pointer',fontSize:10,color:'var(--mu)'}}>✎</button>
                  <button onClick={()=>handleClear(acc.id)} title="Delete" style={{padding:'4px 7px',border:'none',background:'transparent',cursor:'pointer',fontSize:10,color:'var(--ls)'}}>✕</button>
                </div>
              </div>
            )
          })}
          {accounts.length > 0 && <button className="btn btn-d btn-sm" style={{marginLeft:'auto'}} onClick={()=>handleClear(null)}>🗑 Clear all</button>}
        </div>
      )}

      {/* ── DATE RANGE BAR ─────────────────────────────────────────────── */}
      <div className="date-range-bar">
        <span style={{fontSize:10,fontWeight:600,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)'}}>RANGE</span>
        {DATE_PRESETS.map(p => (
          <button key={p.label} className={`preset-btn ${datePreset===p.label?'active':''}`} onClick={()=>applyPreset(p.label)}>{p.label}</button>
        ))}
        <button className={`preset-btn ${showCustom?'active':''}`} onClick={()=>setShowCustom(s=>!s)}>Custom ▾</button>
        {showCustom && (
          <div style={{display:'flex',alignItems:'center',gap:6,marginLeft:4}}>
            <input type="date" className="inp date-input" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{padding:'3px 8px'}} />
            <span style={{color:'var(--mu)',fontSize:11}}>→</span>
            <input type="date" className="inp date-input" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={{padding:'3px 8px'}} />
            <button className="btn btn-p btn-sm" onClick={applyCustom}>Apply</button>
          </div>
        )}
        <span style={{marginLeft:'auto',fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>
          {visibleTrades.length.toLocaleString()} trades
          {datePreset !== 'All' && <span style={{marginLeft:6,color:'var(--bd2)'}}>· {dateFrom} → {dateTo}</span>}
        </span>
      </div>

      {/* ── UPLOAD BAR ─────────────────────────────────────────────────── */}
      <div style={{background:'var(--sf2)',borderBottom:'1px solid var(--bd)',padding:'8px 24px',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        <div className={`dz ${dragOver?'dov':''}`} style={{flex:1,minWidth:260,padding:'8px 14px'}}
          onClick={()=>fileRef.current?.click()}
          onDragOver={e=>{e.preventDefault();setDragOver(true)}}
          onDragLeave={()=>setDragOver(false)}
          onDrop={handleDrop}>
          <span style={{fontSize:15}}>📂</span>
          <div>
            <div style={{fontSize:12,fontWeight:600}}>Upload trade history</div>
            <div style={{fontSize:11,color:'var(--mu)'}}>PrimeXBT CSV · auto-detects format · duplicates skipped</div>
          </div>
          <span className="btn btn-p btn-sm" style={{pointerEvents:'none',marginLeft:'auto',flexShrink:0}}>Browse</span>
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}} onChange={e=>handleFile(e.target.files[0])} />
        {upload.status !== 'idle' && (
          <div className={`pill ${upload.status==='success'?'pb':upload.status==='error'?'pr':'pa'}`}
            style={{fontSize:11,padding:'6px 12px',borderRadius:6,display:'flex',alignItems:'center',gap:6}}>
            {upload.status==='uploading' && <span style={{width:10,height:10,border:'2px solid currentColor',borderTopColor:'transparent',borderRadius:'50%',display:'inline-block',animation:'spin 1s linear infinite'}} />}
            {upload.message}
            {upload.broker && <span style={{opacity:.7}}>· {upload.broker}</span>}
          </div>
        )}
      </div>

      {/* ── NAV TABS ───────────────────────────────────────────────────── */}
      <nav style={{background:'var(--sf)',borderBottom:'1px solid var(--bd)'}}>
        <div style={{display:'flex',padding:'0 24px',gap:0}}>
          {[['overview','📈 Overview'],['coach','🧠 Coach'],['streaks','🔥 Streaks'],['calendar','📅 Calendar'],['symbols','🎯 Symbols'],['timing','⏱ Timing'],['trades','📋 Trade Log']].map(([id,label])=>(
            <div key={id} className={`nt ${tab===id?'active':''}`} onClick={()=>setTab(id)}>{label}</div>
          ))}
        </div>
      </nav>

      {/* ── ACCOUNT RENAME MODAL ──────────────────────────────────────── */}
      {editingAccount && <AccountRenameModal account={editingAccount} onSave={saveAccountLabel} onClose={()=>setEditingAccount(null)} />}

      {/* ── MAIN ────────────────────────────────────────────────────────── */}
      <main style={{padding:'18px 24px',maxWidth:1440,margin:'0 auto'}}>

        {/* OVERVIEW */}
        {tab==='overview' && stats && (
          <div className="anim">
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(138px,1fr))',gap:8,marginBottom:14}}>
              {[
                ['TOTAL P&L',   fU(Math.round(ov.total_pnl)),  ov.total_pnl>=0?'pos':'neg', 'Net realised', true],
                ['WIN RATE',    (ov.win_rate*100).toFixed(1)+'%','acc', `${Math.round(ov.win_rate*ov.total_trades)} W / ${Math.round((1-ov.win_rate)*ov.total_trades)} L`, false],
                ['RISK/REWARD', ov.avg_loss?Math.abs(ov.avg_win/ov.avg_loss).toFixed(2)+'×':'—','wa', `W ${fA(ov.avg_win)} · L ${fA(ov.avg_loss)}`, false],
                ['BEST TRADE',  fU(Math.round(ov.best_trade)),  'pos', 'Single trade', true],
                ['WORST TRADE', fU(Math.round(ov.worst_trade)), 'neg', 'Single trade', true],
                ['LONG P&L',    fU(Math.round(ov.long_pnl)),   'pos', `${(ov.long_wr*100).toFixed(1)}% WR · ${ov.long_count}`, true],
                ['SHORT P&L',   fU(Math.round(ov.short_pnl)),  ov.short_pnl>=0?'pos':'neg', `${(ov.short_wr*100).toFixed(1)}% WR · ${ov.short_count}`, true],
                ['TOTAL TRADES',ov.total_trades.toLocaleString(),'neu','All instruments', false],
              ].map(([l,v,c,s,priv])=>(
                <div key={l} className="kpi">
                  <div className="kl">{l}</div>
                  <div className={`kv ${c} ${priv?'private':''}`}>{v}</div>
                  <div className="ks">{s}</div>
                </div>
              ))}
            </div>
            {/* Account breakdown */}
            {accounts.length > 1 && (
              <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
                {accounts.map(acc => {
                  const at  = visibleTrades.filter(t=>t.account_id===acc.id)
                  if (!at.length) return null
                  const ap  = at.reduce((s,t)=>s+t.pnl,0)
                  const awr = at.filter(t=>t.pnl>0).length/at.length
                  return (
                    <div key={acc.id} style={{background:'var(--sf)',border:`1px solid ${acc.color}30`,borderRadius:8,padding:'8px 14px',display:'flex',alignItems:'center',gap:10,boxShadow:'var(--sh-sm)'}}>
                      <div style={{width:8,height:8,borderRadius:'50%',background:acc.color}} />
                      <div>
                        <div style={{fontSize:11,fontWeight:600}}>{acc.label||acc.id}</div>
                        <div style={{fontSize:10,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>{acc.broker}</div>
                      </div>
                      <div style={{borderLeft:'1px solid var(--bd)',paddingLeft:10}}>
                        <div className="private" style={{fontFamily:'var(--font-mono)',fontSize:12,fontWeight:600,color:ap>=0?'var(--wn)':'var(--ls)'}}>{fU(Math.round(ap))}</div>
                        <div style={{fontSize:10,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>{(awr*100).toFixed(1)}% WR · {at.length}t</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <ChartComp type="equity" data={stats.cumulative} privacy={privacy} />
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}} className="g2">
              <ChartComp type="monthly"  data={stats.monthly} privacy={privacy} />
              <ChartComp type="duration" data={stats.duration} />
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}} className="g2">
              <ChartComp type="direction"    longPnl={ov.long_pnl} shortPnl={ov.short_pnl} privacy={privacy} />
              <ChartComp type="distribution" trades={visibleTrades} />
            </div>
          </div>
        )}

        {/* COACH */}
        {tab==='coach' && (
          <div className="anim">
            <div className="card" style={{marginBottom:14,display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:20,flexWrap:'wrap'}}>
              <div>
                <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.08em',fontFamily:'var(--font-mono)',marginBottom:4}}>TRADING COACH REPORT</div>
                <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>Performance Analysis · {ov?.total_trades?.toLocaleString()||0} Trades</div>
                <div style={{fontSize:12,color:'var(--mu)',lineHeight:1.6,maxWidth:500}}>Recurring errors, behavioural biases, and missed opportunities.</div>
              </div>
              <div style={{textAlign:'center',padding:'8px 20px',borderLeft:'1px solid var(--bd)',flexShrink:0}}>
                <div className="private" style={{fontFamily:'var(--font-mono)',fontSize:44,fontWeight:700,color:'var(--ac)',lineHeight:1}}>62</div>
                <div style={{fontSize:10,fontWeight:600,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',marginTop:2}}>SCORE</div>
              </div>
            </div>
            <CoachInsights />
          </div>
        )}

        {/* STREAKS */}
        {tab==='streaks' && stats && (
          <div className="anim">
            <ChartComp type="streaks" trades={visibleTrades} stats={stats} privacy={privacy} />
          </div>
        )}

        {/* CALENDAR */}
        {tab==='calendar' && <div className="anim"><div className="card">{stats ? renderCalendar() : <div style={{color:'var(--mu)',textAlign:'center',padding:20}}>Loading…</div>}</div></div>}

        {/* SYMBOLS */}
        {tab==='symbols' && stats && (
          <div className="anim">
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}} className="g2">
              <ChartComp type="symbolPnl" data={stats.symbols.slice(0,14)} privacy={privacy} />
              <ChartComp type="symbolWr"  data={stats.symbols.slice(0,14)} />
            </div>
            <div className="card">
              <div className="ct"><span className="ind" />SYMBOL BREAKDOWN
                <span style={{fontSize:10,fontWeight:400,color:'var(--mu)',marginLeft:8}}>SILVER → XAG/USD · GOLD → XAU/USD (normalised)</span>
              </div>
              <div className="tw">
                <table style={{minWidth:540}}>
                  <thead><tr>{['Symbol','Trades','Total P&L','Win Rate','Avg P&L','Assessment'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {stats.symbols.map(s=>{
                      const wr=Math.round(s.win_rate*100)
                      const badge=s.total_pnl>10000&&s.win_rate>.65?<span className="pill pb">KEEP</span>:s.total_pnl<-10000?<span className="pill pr">REDUCE</span>:<span className="pill pn">MONITOR</span>
                      return (
                        <tr key={s.symbol}>
                          <td className="sym-c">{s.symbol}</td><td>{s.count}</td>
                          <td className={`${s.total_pnl>=0?'pos':'neg'} private`}>{fU(Math.round(s.total_pnl))}</td>
                          <td><div style={{display:'flex',alignItems:'center',gap:6}}><div style={{width:48,background:'var(--sf3)',borderRadius:2,height:4}}><div style={{width:wr+'%',height:4,borderRadius:2,background:wr>=65?'var(--wn)':wr<50?'var(--ls)':'var(--wa)'}} /></div><span className={wr>=65?'pos':wr<50?'neg':'wa'}>{wr}%</span></div></td>
                          <td className={`${s.avg_pnl>=0?'pos':'neg'} private`}>{fU(Math.round(s.avg_pnl))}</td>
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

        {/* TIMING */}
        {tab==='timing' && stats && (
          <div className="anim">
            <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
              {[['sessions','Trading Sessions'],['dow','Day of Week'],['hourly','Hour of Day']].map(([id,label])=>(
                <div key={id} className={`st ${timingTab===id?'active':''}`} onClick={()=>setTimingTab(id)}>{label}</div>
              ))}
            </div>
            {timingTab==='sessions' && (
              <>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:8,marginBottom:12}}>
                  {stats.sessions.filter(s=>s.session!=='Other').map(s=>{
                    const wr=(s.win_rate*100).toFixed(1), wrc=s.win_rate>=.65?'var(--wn)':s.win_rate>=.55?'var(--wa)':'var(--ls)'
                    return (
                      <div key={s.session} className="sc">
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                          <div>
                            <div style={{fontWeight:600,fontSize:13,marginBottom:2}}>{s.session}</div>
                            <div style={{fontSize:10,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>{SESSION_TIMES[s.session]}</div>
                          </div>
                          <span className={`pill ${s.win_rate>=.65?'pb':s.win_rate>=.55?'pw':'pr'}`}>{s.win_rate>=.65?'▲ EDGE':s.win_rate>=.55?'→ OK':'▼ WEAK'}</span>
                        </div>
                        <div style={{fontFamily:'var(--font-mono)',fontSize:22,fontWeight:700,color:wrc}}>{wr}%</div>
                        <div style={{marginTop:8,paddingTop:8,borderTop:'1px solid var(--bd)',display:'flex',justifyContent:'space-between',fontSize:11,fontFamily:'var(--font-mono)'}}>
                          <span className={`${s.total_pnl>=0?'pos':'neg'} private`}>{fU(Math.round(s.total_pnl))}</span>
                          <span className="mu">{s.count} trades</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}} className="g2">
                  <ChartComp type="sessionPnl" data={stats.sessions.filter(s=>s.session!=='Other')} privacy={privacy} />
                  <ChartComp type="sessionWr"  data={stats.sessions.filter(s=>s.session!=='Other')} />
                </div>
              </>
            )}
            {timingTab==='dow' && (
              <>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}} className="g2">
                  <ChartComp type="dowPnl" data={stats.daily_dow} privacy={privacy} />
                  <ChartComp type="dowWr"  data={stats.daily_dow} />
                </div>
                <div className="card">
                  <div className="ct"><span className="ind" />DAY OF WEEK</div>
                  <div className="tw">
                    <table style={{minWidth:420}}>
                      <thead><tr>{['Day','Trades','Total P&L','Win Rate','Avg P&L','Signal'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                      <tbody>
                        {stats.daily_dow.map(d=>(
                          <tr key={d.day_of_week}>
                            <td className="sym-c">{d.day_of_week}</td><td>{d.count}</td>
                            <td className={`${d.total_pnl>=0?'pos':'neg'} private`}>{fU(Math.round(d.total_pnl))}</td>
                            <td className={d.win_rate>=.65?'pos':d.win_rate<.55?'neg':'wa'}>{(d.win_rate*100).toFixed(1)}%</td>
                            <td className={`${d.avg_pnl>=0?'pos':'neg'} private`}>{fU(Math.round(d.avg_pnl))}</td>
                            <td><span className={`pill ${d.win_rate>=.65?'pb':d.win_rate<.55?'pr':'pw'}`}>{d.win_rate>=.65?'▲ TRADE FULL':d.win_rate<.55?'▼ AVOID':'→ HALF SIZE'}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
            {timingTab==='hourly' && <ChartComp type="hourly" data={stats.hourly} privacy={privacy} />}
          </div>
        )}

        {/* TRADE LOG */}
        {tab==='trades' && (
          <div className="anim">
            <div style={{fontSize:11,color:'var(--mu)',marginBottom:10,fontFamily:'var(--font-mono)'}}>Click any row to open · ← → keys to navigate · notes and tags saved per trade</div>
            <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:10,flexWrap:'wrap',background:'var(--sf)',border:'1px solid var(--bd)',borderRadius:8,padding:'10px 14px',boxShadow:'var(--sh-sm)'}}>
              <input className="inp" style={{width:160}} placeholder="🔍 Search…" value={search} onChange={e=>setSearch(e.target.value)} />
              {[[fSym,setFSym,['All Symbols',...symbols]],[fDir,setFDir,['Long & Short','Long','Short']],[fRes,setFRes,['Win & Loss','win','loss']],[fSess,setFSess,['All Sessions','Asia','London','London/NY Overlap','New York']]].map(([val,setter,opts],i)=>(
                <select key={i} className="inp" value={val} onChange={e=>setter(e.target.value)}>
                  {opts.map((o,j)=><option key={o} value={j===0?'':o}>{o}</option>)}
                </select>
              ))}
              <span style={{marginLeft:'auto',fontFamily:'var(--font-mono)',fontSize:11,color:'var(--mu)'}}>
                <strong style={{color:'var(--tx)'}}>{filtered.length.toLocaleString()}</strong> trades
              </span>
            </div>
            <div className="card" style={{padding:0,overflow:'hidden'}}>
              <div className="tw">
                <table style={{minWidth:1020}}>
                  <thead><tr>
                    {[['entry_time','Entry'],['symbol','Symbol'],['account_id','Account'],['direction','Dir'],['entry_price','Entry Px'],['exit_price','Exit Px'],['pnl','P&L'],['pct_gain','% Ret'],['duration_mins','Duration'],['session','Session'],['_notes','Notes'],['_r','Result']].map(([k,l])=>(
                      <th key={k} className={sortKey===k?'th-s':''} onClick={()=>{if(!k.startsWith('_')){setSortKey(k);setSortDir(sortKey===k?-sortDir:-1)}}}>
                        {l}{sortKey===k?(sortDir<0?' ↓':' ↑'):''}
                      </th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {paged.map((t,i)=>{
                      const pct = t.pct_gain!=null?(t.pct_gain>=0?'+':'')+t.pct_gain.toFixed(3)+'%':'—'
                      const dur = t.duration_mins?(t.duration_mins/60).toFixed(1)+'h':'—'
                      const acc = accountsMap[t.account_id]
                      const hasNotes = t.notes||t.note_entry_reason||t.note_lessons
                      return (
                        <tr key={t.id||i} className="clk" onClick={()=>setSelected(t)}>
                          <td className="mu">{t.entry_time?.slice(0,16).replace('T',' ')}</td>
                          <td className="sym-c">{t.symbol}</td>
                          <td>{acc&&<span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'2px 6px',borderRadius:4,background:acc.color+'15',border:`1px solid ${acc.color}30`,fontSize:10,fontFamily:'var(--font-mono)',fontWeight:600}}><span style={{width:5,height:5,borderRadius:'50%',background:acc.color}} />{acc.label||acc.id}</span>}</td>
                          <td><span className={`pill ${t.direction==='Long'?'pb':'pr'}`}>{t.direction==='Long'?'▲':'▼'} {t.direction}</span></td>
                          <td>{t.entry_price?.toLocaleString()||'—'}</td>
                          <td>{t.exit_price?.toLocaleString()||'—'}</td>
                          <td className={`${t.pnl>=0?'pos':'neg'} private`}>{fU(t.pnl)}</td>
                          <td className={t.pct_gain>=0?'pos':'neg'}>{pct}</td>
                          <td className="mu">{dur}</td>
                          <td><span className={`pill ${SESSION_CLASS[t.session]||'pn'}`}>{t.session}</span></td>
                          <td style={{textAlign:'center'}}>{hasNotes ? '📝' : <span style={{color:'var(--bd2)'}}>—</span>}</td>
                          <td><span className={`pill ${t.pnl>=0?'pb':'pr'}`}>{t.pnl>=0?'WIN':'LOSS'}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{display:'flex',gap:8,alignItems:'center',padding:'10px 14px',borderTop:'1px solid var(--bd)',background:'var(--sf2)'}}>
                <button className="btn" disabled={page===0} onClick={()=>setPage(p=>p-1)}>← Prev</button>
                <span style={{fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>{page*PAGE+1}–{Math.min((page+1)*PAGE,filtered.length)} of {filtered.length}</span>
                <button className="btn" disabled={(page+1)*PAGE>=filtered.length} onClick={()=>setPage(p=>p+1)}>Next →</button>
              </div>
            </div>
          </div>
        )}

        {/* EMPTY STATE */}
        {!loading && allTrades.length===0 && tab!=='coach' && (
          <div style={{textAlign:'center',padding:'60px 20px'}}>
            <div style={{fontSize:36,marginBottom:12}}>📊</div>
            <div style={{fontWeight:700,fontSize:14,marginBottom:8,color:'var(--tx)'}}>No trades loaded</div>
            <div style={{fontSize:12,color:'var(--mu)'}}>Upload your PrimeXBT CSV export using the bar above.</div>
          </div>
        )}
      </main>

      {selected && (
        <TradeModal
          trade={selected}
          onClose={()=>setSelected(null)}
          trades={visibleTrades}
          onNavigate={t=>setSelected(t)}
          tags={tags}
          onSaved={async () => { await loadTrades(dateFrom, dateTo) }}
        />
      )}
    </>
  )
}

function AccountRenameModal({ account, onSave, onClose }) {
  const [label, setLabel] = useState(account.label || account.id)
  return (
    <div className="mo" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:'var(--sf)',border:'1px solid var(--bd)',borderRadius:10,padding:24,width:340,boxShadow:'var(--sh-lg)',margin:'auto'}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>Rename Account</div>
        <div style={{fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)',marginBottom:16}}>{account.id} · {account.broker}</div>
        <input className="inp" style={{width:'100%',marginBottom:14,padding:'8px 12px',fontSize:13}} value={label}
          onChange={e=>setLabel(e.target.value)} onKeyDown={e=>e.key==='Enter'&&onSave(account.id,label)} autoFocus />
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-p" onClick={()=>onSave(account.id,label)}>Save</button>
        </div>
      </div>
    </div>
  )
}

function CoachInsights() {
  const items = [
    {type:'cr',tag:'⚠ CRITICAL #1',title:'Inverted Risk:Reward Ratio',body:'67.9% WR is excellent but avg loss (-$3,650) is 1.6× avg win (+$2,256). R:R = 0.62×. Three losses erase five wins.',action:'Hard 1.0× R:R minimum before every entry. If target < stop, skip.'},
    {type:'cr',tag:'⚠ CRITICAL #2',title:'Letting Losers Run',body:'Losing trades held 2× longer. Positions >24h: only 51% WR, cost -$179,530. Waiting for recoveries that rarely arrive.',action:'Hard 24-hour maximum on any losing position. Never hold a loser overnight twice.'},
    {type:'cr',tag:'⚠ CRITICAL #3',title:'EUR50, GER30, JAPAN — No Edge',body:'EUR50 (40% WR, -$60k) · GER30 (46%, -$38k) · JAPAN (41%, -$31k). Combined -$129k on 198 trades.',action:'Remove all three. Redeploy capital to XAG/USD and HK-HSI.'},
    {type:'cr',tag:'⚠ CRITICAL #4',title:'XAG/USD — Catastrophic Sizing',body:'82.6% WR, +$340k (SILVER + XAG combined). One trade on 31 Oct 2024 lost -$65,356 — no size discipline.',action:'Max 5% account equity per instrument per day. One outlier should never be possible.'},
    {type:'bi',tag:'⚡ BIAS #1',title:'Revenge Trading — Confirmed',body:'WR after a win: 90.2%. WR after a loss: 20.6%. A 69-point collapse — textbook reactive re-entry.',action:'Mandatory 30-min break after every losing trade.'},
    {type:'bi',tag:'⚡ BIAS #2',title:'Thursday Consistency Collapse',body:'Mon–Wed: 66–76% WR. Thursday: 52.8% WR, -$26,681. Friday: 74.2% WR, +$209k. Systematic every week.',action:'Half position size on Thursdays until pattern is understood.'},
    {type:'op',tag:'💡 OPPORTUNITY #1',title:'XAG/USD — Core Edge (Correctly Measured)',body:'144 trades, 82.6% WR, +$340,746. Average win $5,773. Long-side dominates. This is your primary alpha.',action:'Increase allocation. Document your best 20 entries into a playbook.'},
    {type:'st',tag:'✅ STRENGTH',title:'HK-HSI — Elite Edge, Underallocated',body:'91.6% WR, 143 trades, +$130k. Never a catastrophic loss. Only 10% of trades here vs 33% in breakeven NASDAQ.',action:'Double HK-HSI allocation. Asian open 01:00–04:00 GMT peaks at 96% WR.'},
  ]
  const cfg={cr:{tag:'pr',border:'var(--ls)'},bi:{tag:'pw',border:'var(--wa)'},op:{tag:'pa',border:'var(--ac)'},st:{tag:'pb',border:'var(--wn)'}}
  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}} className="g2">
      {items.map((ins,i)=>{
        const c=cfg[ins.type]
        return (
          <div key={i} className={`ic ic-${ins.type}`}>
            <div style={{marginBottom:8}}><span className={`pill ${c.tag}`}>{ins.tag}</span></div>
            <div style={{fontWeight:600,fontSize:13,marginBottom:5}}>{ins.title}</div>
            <div style={{fontSize:12,color:'var(--tx2)',lineHeight:1.65,marginBottom:10}}>{ins.body}</div>
            <div style={{padding:'8px 10px',background:'var(--sf2)',borderRadius:5,fontSize:11,color:'var(--tx2)',lineHeight:1.6,borderLeft:`2px solid ${c.border}`}}>
              <span style={{fontWeight:600,color:'var(--tx)'}}>Action: </span>{ins.action}
            </div>
          </div>
        )
      })}
    </div>
  )
}
