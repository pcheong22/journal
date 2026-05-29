import { useState, useEffect, useRef, useCallback, Component } from 'react'
import Head from 'next/head'
import { computeStats } from '../lib/tradeUtils'
import dynamic from 'next/dynamic'

// Error boundary — catches client-side crashes and shows the error on screen
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) return (
      <div style={{ padding:24, background:'#0c1117', minHeight:'100vh', color:'#e8edf3', fontFamily:'monospace' }}>
        <div style={{ background:'#2a0a0a', border:'1px solid #ff5258', borderRadius:8, padding:20, maxWidth:800 }}>
          <div style={{ color:'#ff5258', fontWeight:700, fontSize:14, marginBottom:12 }}>⚠ Application Error</div>
          <div style={{ fontSize:12, color:'#e8edf3', marginBottom:8 }}>{this.state.error.message}</div>
          <pre style={{ fontSize:10, color:'#8899aa', whiteSpace:'pre-wrap', overflow:'auto', maxHeight:300, background:'#111', padding:12, borderRadius:4 }}>
            {this.state.error.stack}
          </pre>
          <button onClick={()=>window.location.reload()} style={{ marginTop:12, padding:'8px 16px', background:'#1e2d3d', border:'1px solid #1e2d3d', color:'#e8edf3', cursor:'pointer', borderRadius:5 }}>
            Reload page
          </button>
        </div>
      </div>
    )
    return this.props.children
  }
}
const ChartComp    = dynamic(() => import('../components/Charts'),       { ssr: false })
const Top5PnlChart = dynamic(() => import('../components/Charts').then(m => ({ default: m.Top5PnlChart })), { ssr: false })
const TradeModal = dynamic(() => import('../components/TradeModal'),   { ssr: false })
const ImageGallery = dynamic(() => import('../components/ImageGallery'), { ssr: false })
const fU   = (n, d=0) => (n>=0?'+':'')+n.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:d,maximumFractionDigits:d})
const fA   = n => '$'+Math.abs(n).toLocaleString('en-US',{maximumFractionDigits:0})
const fPct = (n, d=1) => (n>=0?'+':'')+n.toFixed(d)+'%'
const SESSION_TIMES = { Asia:'23:00–07:00 GMT', London:'07:00–12:00 GMT', 'London/NY Overlap':'12:00–16:00 GMT', 'New York':'16:00–22:00 GMT' }
const SESSION_CLASS = { Asia:'pill-asia', London:'pill-london', 'London/NY Overlap':'pill-overlap', 'New York':'pill-ny' }
const BROKER_ICONS  = { PrimeXBT:'🔷', Generic:'📊' }
const BROKER_COLORS = ['#1a56db','#059669','#d97706','#7c3aed','#dc2626','#0891b2','#be185d','#16a34a']
const toISO     = d => d.toISOString().slice(0, 10)
const today     = () => toISO(new Date())
const daysAgo   = n => { const d = new Date(); d.setDate(d.getDate() - n); return toISO(d) }
const monthsAgo = n => { const d = new Date(); d.setMonth(d.getMonth() - n); return toISO(d) }
const ytdStart  = () => `${new Date().getUTCFullYear()}-01-01`
const mtdStart  = () => { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-01` }
const qtdStart  = () => { const d = new Date(); const q = Math.floor(d.getUTCMonth()/3); return `${d.getUTCFullYear()}-${String(q*3+1).padStart(2,'0')}-01` }
const wtdStart  = () => { const d = new Date(); const day = d.getUTCDay(); const diff = day === 0 ? 6 : day - 1; d.setDate(d.getDate() - diff); return toISO(d) }
const DATE_PRESETS = [
  { label: '1W',  from: () => daysAgo(7),    to: today },
  { label: '1M',  from: () => monthsAgo(1),  to: today },
  { label: '3M',  from: () => monthsAgo(3),  to: today },
  { label: '6M',  from: () => monthsAgo(6),  to: today },
  { label: '1Y',  from: () => monthsAgo(12), to: today },
  { label: 'MTD', from: mtdStart,             to: today },
  { label: 'QTD', from: qtdStart,             to: today },
  { label: 'YTD', from: ytdStart,             to: today },
  { label: 'All', from: () => '2000-01-01',  to: today },
]

function DashboardInner() {
  const [tab,            setTab]            = useState('overview')
  const [allTrades,      setAllTrades]      = useState([])
  const [accounts,       setAccounts]       = useState([])
  const [tags,           setTags]           = useState([])
  const [stats,          setStats]          = useState(null)
  const [loading,        setLoading]        = useState(true)
  const [upload,         setUpload]         = useState({ status:'idle', message:'', broker:'', accountId:'' })
  const [dragOver,       setDragOver]       = useState(false)
  const [hlAccountModal, setHlAccountModal] = useState(null) // pending file awaiting account selection
  const [selected,       setSelected]       = useState(null)
  const [privacy,        setPrivacy]        = useState(false)
  const [darkMode,       setDarkMode]       = useState(true)
  const [selAccounts,    setSelAccounts]    = useState(new Set())
  const [datePreset,     setDatePreset]     = useState('YTD')
  const [dateFrom,       setDateFrom]       = useState(ytdStart())
  const [dateTo,         setDateTo]         = useState(today())
  const [showCustom,     setShowCustom]     = useState(false)
  const [calYear,        setCalYear]        = useState(new Date().getUTCFullYear())
  const [calMonth,       setCalMonth]       = useState(new Date().getUTCMonth())
  const [calPickerOpen,  setCalPickerOpen]  = useState(false)
  const [filtered,       setFiltered]       = useState([])
  const [page,           setPage]           = useState(0)
  const [sortKey,        setSortKey]        = useState('entry_time')
  const [sortDir,        setSortDir]        = useState(-1)
  const [fSym,           setFSym]           = useState('')
  const [fDir,           setFDir]           = useState('')
  const [fRes,           setFRes]           = useState('')
  const [fSess,          setFSess]          = useState('')
  const [search,         setSearch]         = useState('')
  const [timingTab,      setTimingTab]      = useState('sessions')
  const [editingAccount, setEditingAccount] = useState(null)
  const [accountOrder,   setAccountOrder]   = useState([]) // drag-reordered account ids
  const [dragAccId,      setDragAccId]      = useState(null)
  const [showSettings,   setShowSettings]   = useState(false)
  const [acctStatsOpen,  setAcctStatsOpen]  = useState(false) // collapsed by default
  const [isClient,       setIsClient]       = useState(false)

  // Settings persisted to localStorage
  const [settings, setSettings] = useState({
    defaultPrivacy:    false,
    defaultDark:       true,
    defaultDatePreset: 'YTD',
    defaultTab:        'overview',
    acctStatsDefault:  false,
    tradeLogPageSize:  50,
  })

  const saveSetting = (key, value) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value }
      if (typeof window !== 'undefined') localStorage.setItem('ti_settings', JSON.stringify(next))
      return next
    })
  }

  const PAGE    = 50
  const fileRef = useRef()

  useEffect(() => {
    setIsClient(true)
    // Load persisted settings
    try {
      const saved = localStorage.getItem('ti_settings')
      if (saved) {
        const s = JSON.parse(saved)
        setSettings(s)
        if (s.defaultPrivacy  !== undefined) setPrivacy(s.defaultPrivacy)
        if (s.defaultDark     !== undefined) setDarkMode(s.defaultDark)
        if (s.acctStatsDefault !== undefined) setAcctStatsOpen(s.acctStatsDefault)
        if (s.defaultTab)      setTab(s.defaultTab)
        if (s.defaultDatePreset && s.defaultDatePreset !== 'YTD') {
          const p = DATE_PRESETS.find(p => p.label === s.defaultDatePreset)
          if (p) { setDatePreset(s.defaultDatePreset); setDateFrom(p.from()); setDateTo(p.to()) }
        }
      }
    } catch(e) {}
  }, [])
  useEffect(() => { document.body.classList.toggle('privacy-on', privacy) }, [privacy])
  useEffect(() => { document.body.classList.toggle('dark-mode', darkMode) }, [darkMode])

  const visibleTrades = allTrades.filter(t => selAccounts.size === 0 || selAccounts.has(t.account_id))

  useEffect(() => {
    setStats(computeStats(visibleTrades))
    if (visibleTrades.length > 0) {
      const tradesWithDates = visibleTrades.filter(t => t.entry_time || t.exit_time)
      if (tradesWithDates.length > 0) {
        const latest = tradesWithDates.reduce((a,b) => {
          const at = a.entry_time || a.exit_time || ''
          const bt = b.entry_time || b.exit_time || ''
          return at > bt ? a : b
        })
        const d = new Date(latest.entry_time || latest.exit_time)
        if (!isNaN(d)) { setCalYear(d.getUTCFullYear()); setCalMonth(d.getUTCMonth()) }
      }
    }
  }, [allTrades, selAccounts])

  useEffect(() => {
    // Enrich trades with computed price_pct for correct sorting
    const enriched = visibleTrades.map(t => {
      let price_pct = null
      if (t.entry_price && t.exit_price && t.entry_price > 0) {
        price_pct = t.direction === 'Long'
          ? (t.exit_price / t.entry_price - 1) * 100
          : (t.entry_price / t.exit_price - 1) * 100
      }
      return { ...t, price_pct }
    })
    let f = [...enriched]
    if (fSym)  f = f.filter(t => t.symbol    === fSym)
    if (fDir)  f = f.filter(t => t.direction === fDir)
    if (fRes === 'win')  f = f.filter(t => t.pnl > 0)
    if (fRes === 'loss') f = f.filter(t => t.pnl < 0)
    if (fSess) f = f.filter(t => t.session   === fSess)
    if (search) f = f.filter(t =>
      (t.symbol+t.direction+t.session+t.entry_time+(t.account_id||'')).toLowerCase().includes(search.toLowerCase())
    )
    // Use price_pct when sorting by pct_gain
    const effectiveSortKey = sortKey === 'pct_gain' ? 'price_pct' : sortKey
    f.sort((a,b) => {
      const av = a[effectiveSortKey] ?? null
      const bv = b[effectiveSortKey] ?? null
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      return sortDir * (av > bv ? 1 : av < bv ? -1 : 0)
    })
    setFiltered(f); setPage(0)
  }, [allTrades, selAccounts, fSym, fDir, fRes, fSess, search, sortKey, sortDir])

  const loadTrades = useCallback(async (from, to) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (from && from !== '2000-01-01') params.set('from', from + 'T00:00:00Z')
      if (to)   params.set('to', to + 'T23:59:59Z')
      const res  = await fetch(`/api/trades?${params}`)
      const data = await res.json()
      if (data.trades)   setAllTrades(data.trades)
      if (data.accounts) {
        setAccounts(data.accounts)
        setAccountOrder(prev => {
          // Preserve existing order, append any new accounts
          const existing = prev.filter(id => data.accounts.find(a => a.id === id))
          const newIds   = data.accounts.filter(a => !prev.includes(a.id)).map(a => a.id)
          return [...existing, ...newIds]
        })
      }
      if (data.tags)     setTags(data.tags)
    } catch(e) { console.error(e) }
    setLoading(false)
  }, [])

  useEffect(() => { loadTrades(dateFrom, dateTo) }, [])

  const applyPreset = (preset) => {
    const p = DATE_PRESETS.find(p => p.label === preset)
    if (!p) return
    const from = p.from(); const to = p.to()
    setDatePreset(preset); setDateFrom(from); setDateTo(to); setShowCustom(false)
    loadTrades(from, to)
  }
  const applyCustom = () => { setDatePreset(''); loadTrades(dateFrom, dateTo) }

  const toggleAccount = id => {
    setSelAccounts(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      if (next.size === accounts.length) return new Set()
      return next
    })
  }
  const selectOnly = id => setSelAccounts(new Set([id]))

  const handleFile = async (file, accountIdOverride = null) => {
    if (!file) return

    // Peek at file to detect Hyperliquid before uploading
    if (!accountIdOverride) {
      const text = await file.text()
      const firstLine = text.split('\n')[0] || ''
      if (firstLine.includes('time,coin,dir,px')) {
        setHlAccountModal(file)
        return
      }
    }

    setUpload({ status:'uploading', message:`Parsing ${file.name}…`, broker:'', accountId:'' })
    const form = new FormData()
    form.append('file', file)
    if (accountIdOverride) form.append('accountId', accountIdOverride)
    try {
      const res  = await fetch('/api/upload', { method:'POST', body:form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setUpload({ status:'success', message:data.message, broker:data.broker||'', accountId:data.accountId||'' })
      if (data.imported > 0) await loadTrades(dateFrom, dateTo)
    } catch(e) { setUpload({ status:'error', message:e.message, broker:'', accountId:'' }) }
  }
  const handleDrop  = e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]) }
  const handleClear = async (accountId = null) => {
    const msg = accountId ? 'Delete account and all its trades?' : 'Delete ALL data for ALL accounts?'
    if (!confirm(msg + ' Cannot be undone.')) return
    await fetch(accountId ? `/api/clear?account=${accountId}` : '/api/clear', { method:'DELETE' })
    await loadTrades(dateFrom, dateTo)
    setUpload({ status:'idle', message:'', broker:'', accountId:'' })
  }
  const saveAccountLabel = async (id, label, color) => {
    await fetch('/api/accounts', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id, label, color }) })
    await loadTrades(dateFrom, dateTo)
    setEditingAccount(null)
  }

  const accountsMap    = Object.fromEntries(accounts.map(a => [a.id, a]))
  const orderedAccounts = accountOrder.map(id => accountsMap[id]).filter(Boolean)
  const symbols     = [...new Set(visibleTrades.map(t => t.symbol))].sort()
  const paged       = filtered.slice(page*PAGE, (page+1)*PAGE)
  const ov          = stats?.overview

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
    const nav = dir => { let m=calMonth+dir,y=calYear; if(m>11){m=0;y++}else if(m<0){m=11;y--}; setCalMonth(m); setCalYear(y); setCalPickerOpen(false) }
    const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return (<>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:calPickerOpen?0:14,position:'relative'}}>
        <button className="btn btn-sm" onClick={()=>nav(-1)}>←</button>
        <button onClick={()=>setCalPickerOpen(o=>!o)}
          style={{flex:1,textAlign:'center',fontWeight:700,fontSize:14,background:'none',border:'none',cursor:'pointer',color:'var(--tx)',display:'flex',alignItems:'center',justifyContent:'center',gap:5}}>
          {MONTHS[calMonth]} {calYear}
          <span style={{fontSize:10,color:'var(--mu)'}}>{calPickerOpen?'▴':'▾'}</span>
        </button>
        <button className="btn btn-sm" onClick={()=>nav(1)}>→</button>
      </div>
      {calPickerOpen && (
        <div style={{background:'var(--sf2)',border:'1px solid var(--bd)',borderRadius:8,padding:'12px',marginBottom:14,boxShadow:'var(--sh-lg)'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
            <button className="btn btn-sm" onClick={()=>setCalYear(y=>y-1)}>◀</button>
            <span style={{fontWeight:700,fontSize:13,fontFamily:'var(--font-mono)'}}>{calYear}</span>
            <button className="btn btn-sm" onClick={()=>setCalYear(y=>y+1)}>▶</button>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:4}}>
            {MONTH_SHORT.map((m,i) => (
              <button key={m} onClick={()=>{setCalMonth(i);setCalPickerOpen(false)}}
                style={{padding:'6px 4px',fontSize:11,fontFamily:'var(--font-mono)',fontWeight:i===calMonth?700:400,
                  border:`1px solid ${i===calMonth?'var(--ac)':'var(--bd)'}`,
                  background:i===calMonth?'var(--ac-bg)':'transparent',
                  color:i===calMonth?'var(--ac2)':'var(--tx2)',
                  borderRadius:5,cursor:'pointer'}}>
                {m}
              </button>
            ))}
          </div>
        </div>
      )}
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3,marginBottom:3}}>
        {['M','T','W','T','F','S','S'].map((d,i)=>(
          <div key={i} style={{textAlign:'center',fontSize:10,fontWeight:600,color:'var(--mu)',fontFamily:'var(--font-mono)',padding:'3px 0',textTransform:'uppercase',letterSpacing:'.04em'}}>{d}</div>
        ))}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3}}>{cells}</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8,marginTop:12}}>
        {[['MONTH P&L',mDays?(mPnl>=0?'+':'-')+fA(mPnl):'No data',mPnl>=0?'var(--wn-tx)':'var(--ls-tx)',true],
          ['WIN RATE',mwr,'var(--ac)',false],
          ['TRADING DAYS',mDays,'var(--tx)',false],
          ['TRADES',mTrades,'var(--tx)',false]].map(([l,v,c,priv])=>(
          <div key={l} style={{background:'var(--sf2)',borderRadius:6,padding:'10px 12px',border:'1px solid var(--bd)'}}>
            <div style={{fontSize:10,fontWeight:600,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:3}}>{l}</div>
            <div className={priv?'private':''} style={{fontFamily:'var(--font-mono)',fontSize:14,fontWeight:600,color:c}}>{v}</div>
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
        <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@300;400;500;600;700&family=JetBrains+Mono:wght@300;400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <header className="page-hdr">
        <div style={{display:'flex',alignItems:'center',gap:14,fontFamily:'var(--font-mono)',fontSize:11}}>
          {ov ? (<>
            <span style={{color:'var(--mu)'}}><span style={{color:'var(--tx)',fontWeight:600}}>{ov.total_trades.toLocaleString()}</span> TRADES</span>
            <span style={{color:'var(--mu)'}}>P&L <span className="private" style={{color:ov.total_pnl>=0?'var(--wn)':'var(--ls)',fontWeight:600}}>{fU(Math.round(ov.total_pnl))}</span></span>
            <span style={{color:'var(--mu)'}}>WR <span style={{color:'var(--ac)',fontWeight:600}}>{(ov.win_rate*100).toFixed(1)}%</span></span>
          </>) : <span style={{color:'var(--mu)'}}>NO DATA</span>}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <button onClick={()=>setShowSettings(s=>!s)} title="Settings"
            style={{background:showSettings?'var(--ac-bg)':'var(--sf2)',border:`1px solid ${showSettings?'var(--ac-bd)':'var(--bd)'}`,borderRadius:6,padding:'5px 8px',cursor:'pointer',transition:'all .15s',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={showSettings?'var(--ac2)':'var(--tx2)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
          <button onClick={()=>setDarkMode(d=>!d)} title={darkMode?'Light mode':'Dark mode'}
            style={{background:'var(--sf2)',border:'1px solid var(--bd)',borderRadius:6,padding:'4px 8px',cursor:'pointer',fontSize:14,transition:'all .15s',color:'var(--tx)'}}>
            {darkMode ? '☀️' : '🌙'}
          </button>
          <button onClick={()=>setPrivacy(p=>!p)} title={privacy?'Show values':'Hide values'}
            style={{background:privacy?'var(--ac-bg)':'var(--sf)',border:`1px solid ${privacy?'var(--ac-bd)':'var(--bd)'}`,borderRadius:6,padding:'5px 8px',cursor:'pointer',transition:'all .15s',display:'flex',alignItems:'center',justifyContent:'center'}}>
            {privacy ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ac2)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="12" rx="9" ry="5.5" stroke="var(--ac2)"/>
                <circle cx="12" cy="12" r="3" fill="var(--ac2)" stroke="none"/>
                <line x1="3" y1="3" x2="21" y2="21"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--tx2)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="12" rx="9" ry="5.5"/>
                <circle cx="12" cy="12" r="3" fill="var(--tx2)" stroke="none"/>
              </svg>
            )}
          </button>
          <span style={{display:'inline-flex',alignItems:'center',gap:5,color:'var(--mu)',fontSize:10}}>
            <span style={{width:6,height:6,borderRadius:'50%',background:'var(--wn)',display:'inline-block',animation:'pulse 2s infinite'}} />LIVE
          </span>
        </div>
      </header>

      {accounts.length > 0 && (
        <div style={{background:'var(--sf)',borderBottom:'1px solid var(--bd)',padding:'8px 24px',display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
          <span style={{fontSize:10,fontWeight:600,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)'}}>ACCOUNTS</span>
          <button onClick={()=>setSelAccounts(new Set())}
            style={{padding:'4px 10px',borderRadius:5,border:'1px solid',fontSize:11,fontFamily:'var(--font-mono)',cursor:'pointer',fontWeight:600,transition:'all .15s',
              background:selAccounts.size===0?'var(--ac)':'var(--sf2)',borderColor:selAccounts.size===0?'var(--ac)':'var(--bd)',color:selAccounts.size===0?'#fff':'var(--tx2)'}}>
            ALL ({allTrades.length.toLocaleString()})
          </button>
          {orderedAccounts.map(acc => {
            const isActive = selAccounts.size===0 || selAccounts.has(acc.id)
            const isDragging = dragAccId === acc.id
            return (
              <div key={acc.id}
                draggable
                onDragStart={()=>setDragAccId(acc.id)}
                onDragOver={e=>{e.preventDefault()}}
                onDrop={()=>{
                  if (!dragAccId || dragAccId===acc.id) return
                  setAccountOrder(prev => {
                    const next = [...prev]
                    const from = next.indexOf(dragAccId)
                    const to   = next.indexOf(acc.id)
                    next.splice(from, 1)
                    next.splice(to, 0, dragAccId)
                    return next
                  })
                  setDragAccId(null)
                }}
                onDragEnd={()=>setDragAccId(null)}
                style={{display:'flex',alignItems:'center',gap:0,borderRadius:6,overflow:'hidden',
                  border:`1px solid ${isActive&&selAccounts.size>0?acc.color:isActive?'var(--bd2)':'var(--bd)'}`,
                  background:isActive&&selAccounts.size>0?acc.color+'18':'var(--sf2)',
                  transition:'all .15s',opacity:isDragging?0.4:1,cursor:'grab'}}>
                <button onClick={()=>toggleAccount(acc.id)}
                  style={{padding:'4px 10px',border:'none',background:'transparent',cursor:'pointer',display:'flex',alignItems:'center',gap:5,fontSize:11,fontFamily:'var(--font-mono)',fontWeight:500,color:isActive?'var(--tx)':'var(--mu)'}}>
                  <span style={{width:8,height:8,borderRadius:'50%',background:acc.color,flexShrink:0,opacity:isActive?1:.4}} />
                  <span style={{fontWeight:600}}>{acc.label||acc.id}</span>
                </button>
                <div style={{borderLeft:'1px solid var(--bd)',display:'flex'}}>
                  <button onClick={()=>selectOnly(acc.id)} title="View only" style={{padding:'4px 7px',border:'none',background:'transparent',cursor:'pointer',fontSize:10,color:'var(--mu)'}}>⊙</button>
                  <button onClick={()=>setEditingAccount(acc)} title="Edit" style={{padding:'4px 7px',border:'none',background:'transparent',cursor:'pointer',fontSize:10,color:'var(--mu)'}}>✎</button>
                  <button onClick={()=>handleClear(acc.id)} title="Delete" style={{padding:'4px 7px',border:'none',background:'transparent',cursor:'pointer',fontSize:10,color:'var(--ls)'}}>✕</button>
                </div>
              </div>
            )
          })}
          {accounts.length > 0 && <button className="btn btn-d btn-sm" style={{marginLeft:'auto'}} onClick={()=>handleClear(null)}>🗑 Clear all</button>}
        </div>
      )}

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
          {datePreset !== 'All' && <span className="date-range-text" style={{marginLeft:6,color:'var(--bd2)'}}>· {dateFrom} → {dateTo}</span>}
        </span>
      </div>

      <div style={{background:'var(--sf2)',borderBottom:'1px solid var(--bd)',padding:'8px 24px',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        <div className={`dz ${dragOver?'dov':''}`} style={{flex:1,minWidth:260,padding:'8px 14px'}}
          onClick={()=>fileRef.current?.click()}
          onDragOver={e=>{e.preventDefault();setDragOver(true)}}
          onDragLeave={()=>setDragOver(false)}
          onDrop={handleDrop}>
          <span style={{fontSize:15}}>📂</span>
          <div>
            <div style={{fontSize:12,fontWeight:600}}>Upload trade history</div>
            <div style={{fontSize:11,color:'var(--mu)'}}>PrimeXBT · IBKR · Extended · Hyperliquid · Bybit · auto-detects format · duplicates skipped</div>
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

      <nav style={{background:'var(--sf)',borderBottom:'1px solid var(--bd)'}}>
        <div style={{display:'flex',padding:'0 24px',gap:0}}>
          {[['overview','📈 Overview'],['coach','🧠 Coach'],['streaks','🔥 Streaks'],['calendar','📅 Calendar'],['symbols','🎯 Symbols'],['timing','⏱ Timing'],['trades','📋 Trade Log'],['missed','⏭ Passed']].map(([id,label])=>(
            <div key={id} className={`nt ${tab===id?'active':''}`} onClick={()=>setTab(id)}>{label}</div>
          ))}
        </div>
      </nav>

      {editingAccount && <AccountRenameModal account={editingAccount} onSave={saveAccountLabel} onClose={()=>setEditingAccount(null)} />}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          saveSetting={saveSetting}
          privacy={privacy}           setPrivacy={setPrivacy}
          darkMode={darkMode}         setDarkMode={setDarkMode}
          acctStatsOpen={acctStatsOpen} setAcctStatsOpen={setAcctStatsOpen}
          onClose={()=>setShowSettings(false)}
        />
      )}
      {hlAccountModal && (
        <HyperliquidAccountModal
          onSelect={accountId => { setHlAccountModal(null); handleFile(hlAccountModal, accountId) }}
          onClose={() => setHlAccountModal(null)}
          existingAccounts={accounts.filter(a => a.broker === 'Hyperliquid')}
        />
      )}

      <main style={{padding:'18px 24px',maxWidth:1440,margin:'0 auto'}}>

        {tab==='overview' && stats && (
          <div className="anim">
            {(() => {
              const wins   = Math.round(ov.win_rate * ov.total_trades)
              const losses = ov.total_trades - wins
              const exp    = (losses > 0 && ov.avg_loss) ? (wins * ov.avg_win) / (losses * Math.abs(ov.avg_loss)) : null
              const expVal = exp != null ? exp.toFixed(2)+'×' : '—'
              const expC   = exp == null ? 'neu' : exp >= 1 ? 'pos' : 'neg'
              const vol = visibleTrades.reduce((s, t) => {
                const n = t.notional_usd
                if (!n) return s
                // notional_usd is already in USD (back-solved from P&L)
                // entry notional = exit notional × price ratio (adjusted for direction)
                if (t.entry_price && t.exit_price && t.exit_price > 0) {
                  const ratio = t.direction === 'Short'
                    ? t.exit_price / t.entry_price
                    : t.entry_price / t.exit_price
                  return s + n + (n * ratio)
                }
                return s + n * 2 // fallback if no prices
              }, 0)
              const fmtVol = v => {
                if (v >= 1e9) return (v/1e9).toFixed(2) + ' billion'
                if (v >= 1e6) return (v/1e6).toFixed(2) + ' million'
                return '$' + Math.round(v).toLocaleString()
              }
              return (
                <div className="kpi-grid-overview" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(138px,1fr))',gap:8,marginBottom:14}}>
                  <div className="kpi">
                    <div className="kl">TOTAL P&L</div>
                    <div className={`kv ${ov.total_pnl>=0?'pos':'neg'} private`}>{fU(Math.round(ov.total_pnl))}</div>
                    <div className="ks">Net realised</div>
                  </div>
                  <div className="kpi">
                    <div className="kl">WIN RATE</div>
                    <div className="kv acc">{(ov.win_rate*100).toFixed(1)}%</div>
                    <div className="ks">{Math.round(ov.win_rate*ov.total_trades)} W / {Math.round((1-ov.win_rate)*ov.total_trades)} L</div>
                  </div>
                  <div className="kpi">
                    <div className="kl">TOTAL TRADES</div>
                    <div className="kv neu">{ov.total_trades.toLocaleString()}</div>
                    <div className="ks">All instruments</div>
                  </div>
                  <RiskRewardCard rr={ov.avg_loss ? Math.abs(ov.avg_win/ov.avg_loss) : null} avgWin={ov.avg_win} avgLoss={ov.avg_loss} />
                  <ExpectancyCard expVal={expVal} expC={expC} />
                  <CalmarCard calmar={ov.calmar} maxDrawdown={ov.max_drawdown} />
                  <div className="kpi">
                    <div className="kl">LONG P&L</div>
                    <div className="kv pos private">{fU(Math.round(ov.long_pnl))}</div>
                    <div className="ks">{(ov.long_wr*100).toFixed(1)}% WR · {ov.long_count}</div>
                  </div>
                  <div className="kpi">
                    <div className="kl">SHORT P&L</div>
                    <div className={`kv ${ov.short_pnl>=0?'pos':'neg'} private`}>{fU(Math.round(ov.short_pnl))}</div>
                    <div className="ks">{(ov.short_wr*100).toFixed(1)}% WR · {ov.short_count}</div>
                  </div>
                  <div className="kpi">
                    <div className="kl">TOTAL VOLUME</div>
                    <div className="kv neu private">{vol > 0 ? fmtVol(vol) : '—'}</div>
                    <div className="ks">Entry + exit notional</div>
                  </div>
                </div>
              )
            })()}
            {accounts.length > 1 && (
              <div style={{marginBottom:14}}>
                <button onClick={()=>setAcctStatsOpen(o=>!o)}
                  style={{background:'none',border:'none',cursor:'pointer',color:'var(--mu)',fontSize:10,fontFamily:'var(--font-mono)',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',display:'flex',alignItems:'center',gap:5,padding:'0 0 8px',transition:'color .15s'}}
                  onMouseEnter={e=>e.currentTarget.style.color='var(--tx)'}
                  onMouseLeave={e=>e.currentTarget.style.color='var(--mu)'}>
                  {acctStatsOpen ? '▲' : '▼'} ACCOUNT BREAKDOWN {acctStatsOpen ? '(collapse)' : '(expand)'}
                </button>
                {acctStatsOpen && (
                  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                    {orderedAccounts.map(acc => {
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
              </div>
            )}
            <ChartComp type="equity" data={stats.cumulative} privacy={privacy} />
            {/* Row 1: Monthly P&L — full width spotlight */}
            <ChartComp type="monthly" data={stats.monthly} privacy={privacy} />
            {/* Row 2: Three equal supporting charts */}
            <div className="g3" style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:10}}>
              <ChartComp type="duration"     data={stats.duration} privacy={privacy} />
              <ChartComp type="direction"    longPnl={ov.long_pnl} shortPnl={ov.short_pnl} privacy={privacy} />
              <ChartComp type="distribution" trades={visibleTrades} privacy={privacy} />
            </div>
            {/* Row 3: Top 5 instruments */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}} className="g2">
              <Top5PnlChart trades={visibleTrades} mode="positive" privacy={privacy} />
              <Top5PnlChart trades={visibleTrades} mode="negative" privacy={privacy} />
            </div>
          </div>
        )}

        {tab==='coach' && (
          <CoachTab stats={stats} tradeCount={visibleTrades.length} datePreset={datePreset} dateFrom={dateFrom} dateTo={dateTo} />
        )}

        {tab==='streaks' && stats && (
          <div className="anim">
            <ChartComp type="streaks" trades={visibleTrades} stats={stats} privacy={privacy} />
          </div>
        )}

        {tab==='calendar' && <div className="anim"><div className="card">{stats ? renderCalendar() : <div style={{color:'var(--mu)',textAlign:'center',padding:20}}>Loading…</div>}</div></div>}

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

        {tab==='timing' && stats && (
          <div className="anim">
            <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
              {[['sessions','Trading Sessions'],['dow','Day of Week'],['hourly','Hour of Day']].map(([id,label])=>(
                <div key={id} className={`st ${timingTab===id?'active':''}`} onClick={()=>setTimingTab(id)}>{label}</div>
              ))}
            </div>
            {timingTab==='sessions' && (<>
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
            </>)}
            {timingTab==='dow' && (<>
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
            </>)}
            {timingTab==='hourly' && <ChartComp type="hourly" data={stats.hourly} privacy={privacy} />}
          </div>
        )}

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
              <div className="tw trade-tbl-wrap">
                <table style={{minWidth:1020}}>
                  <thead><tr>
                    {[['entry_time','Entry'],['exit_time','Exit'],['duration_mins','Duration'],['symbol','Symbol'],['account_id','Account'],['direction','Dir'],['entry_price','Entry Px'],['exit_price','Exit Px'],['notional_usd','Notional'],['pnl','P&L'],['pct_gain','% Ret'],['session','Session'],['_notes','Notes'],['_r','Result']].map(([k,l])=>(
                      <th key={k} className={sortKey===k?'th-s':''} onClick={()=>{if(!k.startsWith('_')){setSortKey(k);setSortDir(sortKey===k?-sortDir:-1)}}}>
                        {l}{sortKey===k?(sortDir<0?' ↓':' ↑'):''}
                      </th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {paged.map((t,i)=>{
                      const pct = t.price_pct ?? null
                      const pctStr = pct != null ? (pct >= 0 ? '+' : '') + pct.toFixed(3) + '%' : '—'
                      const dur = t.duration_mins?(t.duration_mins/60).toFixed(1)+'h':'—'
                      const acc = accountsMap[t.account_id]
                      const hasNotes = t.notes||t.note_entry_reason||t.note_lessons
                      return (
                        <tr key={t.id||i} className="clk" onClick={()=>setSelected(t)}>
                          <td className="mu">{t.entry_time?.slice(0,16).replace('T',' ')}</td>
                          <td className="mu">{t.exit_time?.slice(0,16).replace('T',' ')}</td>
                          <td className="mu">{dur}</td>
                          <td className="sym-c">{t.symbol}</td>
                          <td>{acc&&<span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'2px 6px',borderRadius:4,background:acc.color+'15',border:`1px solid ${acc.color}30`,fontSize:10,fontFamily:'var(--font-mono)',fontWeight:600}}><span style={{width:5,height:5,borderRadius:'50%',background:acc.color}} />{acc.label||acc.id}</span>}</td>
                          <td><span style={{fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:4,color:t.direction==='Long'?'#00b5a3':'#ffb300',background:t.direction==='Long'?'rgba(0,181,163,.12)':'rgba(255,179,0,.12)',border:`1px solid ${t.direction==='Long'?'#00b5a3':'#ffb300'}`}}>{t.direction==='Long'?'▲':'▼'} {t.direction}</span></td>
                          <td>{t.entry_price?.toLocaleString()||'—'}</td>
                          <td>{t.exit_price?.toLocaleString()||'—'}</td>
                          <td className="private" style={{fontFamily:'var(--font-mono)',fontSize:11}}>{t.notional_usd ? '$'+Math.round(t.notional_usd).toLocaleString() : '—'}</td>
                          <td className={`${t.pnl>=0?'pos':'neg'} private`}>{fU(t.pnl)}</td>
                          <td className={pct!=null?(pct>=0?'pos':'neg'):''}>{pctStr}</td>
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

        {tab==='missed' && (
          <MissedTab dateFrom={dateFrom} dateTo={dateTo} datePreset={datePreset} visibleTrades={visibleTrades} />
        )}

        {!loading && allTrades.length===0 && tab!=='coach' && tab!=='missed' && (
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

export default function Dashboard() {
  return <ErrorBoundary><DashboardInner /></ErrorBoundary>
}

function RiskRewardCard({ rr, avgWin, avgLoss }) {
  const [show, setShow] = useState(false)
  const fA = n => '$'+Math.abs(n).toLocaleString('en-US',{maximumFractionDigits:0})
  const c  = rr == null ? 'neu' : rr >= 2 ? 'pos' : rr >= 1 ? 'wa' : rr >= 0.5 ? 'wa' : 'neg'
  return (
    <div className="kpi" style={{position:'relative'}}>
      <div style={{display:'flex',alignItems:'center',gap:4}}>
        <div className="kl">WIN/LOSS RATIO</div>
        <span
          onMouseEnter={()=>setShow(true)} onMouseLeave={()=>setShow(false)}
          onClick={()=>setShow(s=>!s)}
          style={{fontSize:9,color:'var(--ac)',cursor:'pointer',lineHeight:1,userSelect:'none',marginBottom:2}}>ⓘ</span>
      </div>
      <div className="kv acc">{rr != null ? rr.toFixed(2)+'×' : '—'}</div>
      <div className="ks">{avgLoss ? `AvgW ${fA(avgWin)} · AvgL ${fA(avgLoss)}` : '—'}</div>
      {show && (
        <div style={{position:'absolute',top:'calc(100% + 6px)',left:0,zIndex:200,background:'var(--sf)',border:'1px solid var(--bd)',borderRadius:8,padding:'12px 14px',boxShadow:'var(--sh-lg)',width:280,pointerEvents:'none'}}>
          <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:8}}>WIN/LOSS RATIO</div>
          <div style={{fontSize:11,color:'var(--tx2)',lineHeight:1.7,marginBottom:10}}>
            Average winning trade divided by average losing trade. Measures how much you make on winners relative to what you lose on losers.
          </div>
          <div style={{fontSize:10,color:'var(--mu)',fontFamily:'var(--font-mono)',marginBottom:8}}>Formula: Avg Win ÷ Avg Loss</div>
          <div style={{display:'grid',gap:5,marginBottom:10}}>
            {[
              ['Below 0.5×', 'Poor. Losses are more than double your wins — requires a very high win rate to be profitable.', 'var(--ls)'],
              ['0.5× – 1.0×', 'Marginal. Can still be profitable with a sufficiently high win rate, but edge is thin.', 'var(--wa)'],
              ['1.0× – 2.0×', 'Good. Winners exceed losers — a sustainable foundation for a trading system.', 'var(--wn)'],
              ['Above 2.0×',  'Strong. Each win more than doubles each loss — high-quality edge.', 'var(--wn)'],
            ].map(([range, desc, col]) => (
              <div key={range} style={{display:'flex',gap:8,alignItems:'flex-start'}}>
                <span style={{fontSize:10,fontFamily:'var(--font-mono)',color:col,fontWeight:700,flexShrink:0,minWidth:70}}>{range}</span>
                <span style={{fontSize:10,color:'var(--mu)',lineHeight:1.5}}>{desc}</span>
              </div>
            ))}
          </div>
          <div style={{padding:'8px 10px',background:'var(--ac-bg)',border:'1px solid var(--ac-bd)',borderRadius:5,fontSize:10,color:'var(--ac2)',lineHeight:1.6}}>
            <span style={{fontWeight:700}}>⚠ Do not read in isolation.</span> A 0.7× R/R with a 72% win rate is highly profitable. A 2.0× R/R with a 30% win rate may not be. Always consider R/R alongside win rate and expectancy together.
          </div>
        </div>
      )}
    </div>
  )
}

function CalmarCard({ calmar, maxDrawdown }) {
  const [show, setShow] = useState(false)
  const c = calmar == null ? 'neu' : calmar >= 3 ? 'pos' : calmar >= 1 ? 'wa' : 'neg'
  return (
    <div className="kpi" style={{position:'relative'}}>
      <div style={{display:'flex',alignItems:'center',gap:4}}>
        <div className="kl">CALMAR RATIO</div>
        <span
          onMouseEnter={()=>setShow(true)} onMouseLeave={()=>setShow(false)}
          onClick={()=>setShow(s=>!s)}
          style={{fontSize:9,color:'var(--ac)',cursor:'pointer',lineHeight:1,userSelect:'none',marginBottom:2}}>ⓘ</span>
      </div>
      <div className={`kv ${c}`}>{calmar != null ? calmar.toFixed(2)+'×' : '—'}</div>
      <div className="ks">{calmar != null ? `DD $${Math.round(maxDrawdown).toLocaleString()}` : 'Min 20 trades'}</div>
      {show && (
        <div style={{position:'absolute',top:'calc(100% + 6px)',left:0,zIndex:200,background:'var(--sf)',border:'1px solid var(--bd)',borderRadius:8,padding:'12px 14px',boxShadow:'var(--sh-lg)',width:272,pointerEvents:'none'}}>
          <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:8}}>CALMAR RATIO</div>
          <div style={{fontSize:11,color:'var(--tx2)',lineHeight:1.7,marginBottom:10}}>
            Annualised P&L divided by maximum drawdown. Measures how much return you generate per dollar of peak-to-trough loss — the higher the better.
          </div>
          <div style={{fontSize:10,color:'var(--mu)',fontFamily:'var(--font-mono)',marginBottom:8}}>Formula: (P&L × 365 / days) ÷ Max Drawdown</div>
          <div style={{display:'grid',gap:5}}>
            {[
              ['Below 1×', 'Return is less than your worst drawdown. Risk is not being rewarded.', 'var(--ls)'],
              ['1× – 3×',  'Moderate edge. You are earning more than you draw down, but there is room to tighten risk.', 'var(--wa)'],
              ['Above 3×', 'Exceptional. Annual return significantly exceeds max drawdown — the hallmark of disciplined risk management.', 'var(--wn)'],
            ].map(([range, desc, col]) => (
              <div key={range} style={{display:'flex',gap:8,alignItems:'flex-start'}}>
                <span style={{fontSize:10,fontFamily:'var(--font-mono)',color:col,fontWeight:700,flexShrink:0,minWidth:60}}>{range}</span>
                <span style={{fontSize:10,color:'var(--mu)',lineHeight:1.5}}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ExpectancyCard({ expVal, expC }) {
  const [show, setShow] = useState(false)
  const colorMap = { pos:'var(--wn)', neg:'var(--ls)', neu:'var(--tx)', acc:'var(--ac)', wa:'var(--wa)' }
  return (
    <div className="kpi" style={{position:'relative'}}>
      <div style={{display:'flex',alignItems:'center',gap:4}}>
        <div className="kl">EXPECTANCY</div>
        <span
          onMouseEnter={()=>setShow(true)} onMouseLeave={()=>setShow(false)}
          onClick={()=>setShow(s=>!s)}
          style={{fontSize:9,color:'var(--ac)',cursor:'pointer',lineHeight:1,userSelect:'none',marginBottom:2}}>ⓘ</span>
      </div>
      <div className={`kv ${expC}`}>{expVal}</div>
      <div className="ks">%W×AvgW / %L×AvgL</div>
      {show && (
        <div style={{position:'absolute',top:'calc(100% + 6px)',left:0,zIndex:200,background:'var(--sf)',border:'1px solid var(--bd)',borderRadius:8,padding:'12px 14px',boxShadow:'var(--sh-lg)',width:280,pointerEvents:'none'}}>
          <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:8}}>EXPECTANCY</div>
          <div style={{fontSize:11,color:'var(--tx2)',lineHeight:1.7,marginBottom:10}}>
            For every $1 lost on losing trades, how many dollars do you make on winners. A measure of your edge quality, independent of win rate.
          </div>
          <div style={{fontSize:10,color:'var(--mu)',fontFamily:'var(--font-mono)',marginBottom:8}}>Formula: (%W × AvgW) ÷ (%L × AvgL)</div>
          <div style={{display:'grid',gap:5}}>
            {[
              ['Below 1.0×', 'Negative expectancy — losing more on losers than winning on winners.', 'var(--ls)'],
              ['1.0× – 1.5×', 'Positive but marginal. Profitable system, room to improve.', 'var(--wa)'],
              ['1.5× – 2.0×', 'Solid edge. Winners meaningfully outweigh losers.', 'var(--wn)'],
              ['Above 2.0×',  'Strong edge. Hallmark of elite traders.', 'var(--ac)'],
            ].map(([range, desc, col]) => (
              <div key={range} style={{display:'flex',gap:8,alignItems:'flex-start'}}>
                <span style={{fontSize:10,fontFamily:'var(--font-mono)',color:col,fontWeight:700,flexShrink:0,minWidth:70}}>{range}</span>
                <span style={{fontSize:10,color:'var(--mu)',lineHeight:1.5}}>{desc}</span>
              </div>
            ))}
          </div>
          <div style={{marginTop:10,paddingTop:8,borderTop:'1px solid var(--bd)',fontSize:10,color:'var(--mu)',lineHeight:1.5,fontStyle:'italic'}}>
            Note: A high win rate alone does not guarantee positive expectancy — losses must be kept small relative to wins.
          </div>
        </div>
      )}
    </div>
  )
}

const HL_ACCOUNTS = [
  { id:'0xffbB07326634300D7ef131E2B5826Dcb49c0C8E0', label:'Hyperliquid 0xffbB....C8E0' },
  { id:'0x2A8F7F1682B629b16f5309182DA8920dAF72D0F9', label:'Hyperliquid 0x2A8F....D0F9' },
]

function HyperliquidAccountModal({ onSelect, onClose, existingAccounts }) {
  const [custom, setCustom] = useState('')
  const [showCustom, setShowCustom] = useState(false)

  return (
    <div className="mo" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:'var(--sf)',border:'1px solid var(--bd)',borderRadius:10,padding:24,width:420,boxShadow:'var(--sh-lg)',margin:'auto'}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>Which Hyperliquid account?</div>
        <div style={{fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)',marginBottom:18}}>
          Select the account this trade history belongs to
        </div>
        <div style={{display:'grid',gap:8,marginBottom:14}}>
          {HL_ACCOUNTS.map(acc => (
            <button key={acc.id} onClick={()=>onSelect(acc.id)}
              style={{padding:'10px 14px',border:'1px solid var(--bd)',borderRadius:7,background:'var(--sf2)',cursor:'pointer',textAlign:'left',transition:'all .15s'}}
              onMouseEnter={e=>e.currentTarget.style.borderColor='var(--ac)'}
              onMouseLeave={e=>e.currentTarget.style.borderColor='var(--bd)'}>
              <div style={{fontWeight:600,fontSize:12,color:'var(--tx)',marginBottom:2}}>{acc.label}</div>
              <div style={{fontSize:10,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>{acc.id}</div>
            </button>
          ))}
        </div>
        {!showCustom ? (
          <button className="btn btn-sm" onClick={()=>setShowCustom(true)} style={{marginBottom:14}}>
            + Add a different account
          </button>
        ) : (
          <div style={{marginBottom:14}}>
            <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:6}}>WALLET ADDRESS</div>
            <div style={{display:'flex',gap:8}}>
              <input className="inp" style={{flex:1,fontFamily:'var(--font-mono)',fontSize:11}} placeholder="0x..." value={custom} onChange={e=>setCustom(e.target.value)} autoFocus />
              <button className="btn btn-p btn-sm" disabled={!custom.startsWith('0x')} onClick={()=>onSelect(custom)}>Use</button>
            </div>
          </div>
        )}
        <div style={{display:'flex',justifyContent:'flex-end'}}>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function SettingsPanel({ settings, saveSetting, privacy, setPrivacy, darkMode, setDarkMode, acctStatsOpen, setAcctStatsOpen, onClose }) {
  const DATE_PRESETS = ['YTD','1Y','6M','3M','1M','MTD','QTD','All']
  const TABS         = ['overview','coach','streaks','calendar','symbols','timing','tradelog','missed']
  const TAB_LABELS   = { overview:'Overview', coach:'Coach', streaks:'Streaks', calendar:'Calendar', symbols:'Symbols', timing:'Timing', tradelog:'Trade Log', missed:'Passed' }
  const PAGE_SIZES   = [50, 100, 200]

  const Row = ({ label, sub, children }) => (
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 0',borderBottom:'1px solid var(--bd)'}}>
      <div>
        <div style={{fontSize:12,fontWeight:600,color:'var(--tx)'}}>{label}</div>
        {sub && <div style={{fontSize:10,color:'var(--mu)',marginTop:2}}>{sub}</div>}
      </div>
      <div style={{flexShrink:0,marginLeft:16}}>{children}</div>
    </div>
  )

  const Toggle = ({ value, onChange }) => (
    <button onClick={()=>onChange(!value)}
      style={{width:42,height:24,borderRadius:12,border:'none',cursor:'pointer',transition:'all .2s',
        background:value?'var(--ac)':'var(--bd2)',position:'relative',flexShrink:0}}>
      <span style={{position:'absolute',top:3,left:value?20:3,width:18,height:18,borderRadius:'50%',background:'#fff',transition:'left .2s',display:'block'}} />
    </button>
  )

  const Select = ({ value, options, onChange }) => (
    <select value={value} onChange={e=>onChange(e.target.value)} className="inp"
      style={{padding:'4px 8px',fontSize:11,fontFamily:'var(--font-mono)',minWidth:90}}>
      {options.map(o => <option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}
    </select>
  )

  return (
    <div className="mo" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:'var(--sf)',border:'1px solid var(--bd)',borderRadius:12,width:420,maxHeight:'85vh',overflow:'auto',boxShadow:'var(--sh-lg)',margin:'auto',position:'relative'}}>
        <div style={{padding:'18px 24px',borderBottom:'1px solid var(--bd)',display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,background:'var(--sf)',zIndex:10}}>
          <div>
            <div style={{fontWeight:700,fontSize:15}}>Settings</div>
            <div style={{fontSize:10,color:'var(--mu)',fontFamily:'var(--font-mono)',marginTop:2}}>Preferences saved to this browser</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'var(--mu)',fontSize:18,padding:4}}>✕</button>
        </div>
        <div style={{padding:'0 24px 24px'}}>

          {/* APPEARANCE */}
          <div style={{fontSize:9,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.08em',fontFamily:'var(--font-mono)',padding:'16px 0 4px'}}>APPEARANCE</div>
          <Row label="Dark mode" sub="Default theme on load">
            <Toggle value={settings.defaultDark} onChange={v=>{saveSetting('defaultDark',v); setDarkMode(v)}} />
          </Row>
          <Row label="Privacy mode" sub="Hide P&L values on load">
            <Toggle value={settings.defaultPrivacy} onChange={v=>{saveSetting('defaultPrivacy',v); setPrivacy(v)}} />
          </Row>

          {/* DASHBOARD */}
          <div style={{fontSize:9,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.08em',fontFamily:'var(--font-mono)',padding:'16px 0 4px'}}>DASHBOARD</div>
          <Row label="Default date range" sub="Range selected on load">
            <Select value={settings.defaultDatePreset} options={DATE_PRESETS} onChange={v=>saveSetting('defaultDatePreset',v)} />
          </Row>
          <Row label="Default tab" sub="Tab open on load">
            <Select value={settings.defaultTab}
              options={TABS.map(t=>({value:t, label:TAB_LABELS[t]}))}
              onChange={v=>saveSetting('defaultTab',v)} />
          </Row>
          <Row label="Account breakdown" sub="Expanded or collapsed on load">
            <Toggle value={settings.acctStatsDefault} onChange={v=>{saveSetting('acctStatsDefault',v); setAcctStatsOpen(v)}} />
          </Row>

          {/* TRADE LOG */}
          <div style={{fontSize:9,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.08em',fontFamily:'var(--font-mono)',padding:'16px 0 4px'}}>TRADE LOG</div>
          <Row label="Rows per page" sub="Number of trades shown per page">
            <Select value={settings.tradeLogPageSize} options={PAGE_SIZES.map(n=>({value:n,label:n+' rows'}))} onChange={v=>saveSetting('tradeLogPageSize',parseInt(v))} />
          </Row>

          {/* RESET */}
          <div style={{marginTop:20,paddingTop:16,borderTop:'1px solid var(--bd)'}}>
            <button className="btn" onClick={()=>{
              localStorage.removeItem('ti_settings')
              window.location.reload()
            }} style={{fontSize:11,color:'var(--ls)',borderColor:'var(--ls)'}}>
              Reset all settings to defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AccountRenameModal({ account, onSave, onClose }) {
  const [label, setLabel] = useState(account.label || account.id)
  const [color, setColor] = useState(account.color || '#1a56db')

  const PRESET_COLORS = [
    '#1a56db','#059669','#d97706','#7c3aed',
    '#dc2626','#0891b2','#be185d','#16a34a',
    '#ea580c','#0284c7','#9333ea','#15803d',
    '#f59e0b','#db2777','#2563eb','#65a30d',
  ]

  return (
    <div className="mo" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:'var(--sf)',border:'1px solid var(--bd)',borderRadius:10,padding:24,width:360,boxShadow:'var(--sh-lg)',margin:'auto'}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>Edit Account</div>
        <div style={{fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)',marginBottom:16}}>{account.id} · {account.broker}</div>

        <div style={{marginBottom:14}}>
          <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:6}}>LABEL</div>
          <input className="inp" style={{width:'100%',padding:'8px 12px',fontSize:13}} value={label}
            onChange={e=>setLabel(e.target.value)} onKeyDown={e=>e.key==='Enter'&&onSave(account.id,label,color)} autoFocus />
        </div>

        <div style={{marginBottom:18}}>
          <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:8}}>COLOUR</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(8,1fr)',gap:6,marginBottom:10}}>
            {PRESET_COLORS.map(c => (
              <button key={c} onClick={()=>setColor(c)}
                style={{width:'100%',aspectRatio:'1',borderRadius:6,border:`2px solid ${color===c?'#fff':'transparent'}`,background:c,cursor:'pointer',boxShadow:color===c?'0 0 0 2px '+c:'none',transition:'all .15s'}} />
            ))}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:28,height:28,borderRadius:6,background:color,border:'1px solid var(--bd)',flexShrink:0}} />
            <input type="color" value={color} onChange={e=>setColor(e.target.value)}
              style={{width:40,height:28,padding:2,border:'1px solid var(--bd)',borderRadius:5,background:'var(--sf2)',cursor:'pointer'}} />
            <span style={{fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>{color} · or pick custom</span>
          </div>
        </div>

        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-p" onClick={()=>onSave(account.id,label,color)}>Save</button>
        </div>
      </div>
    </div>
  )
}


const REASON_OPTIONS = [
  'Already at daily trade limit',
  'Hesitated / missed the entry',
  'Risk too high / position size concern',
  "Setup wasn't quite right",
  'Distracted / not at desk',
  'Intentionally passed (good discipline)',
  'Other',
]

function MissedTab({ dateFrom, dateTo, datePreset, visibleTrades }) {
  const [missed,       setMissed]    = useState([])
  const [loading,      setLoading]   = useState(true)
  const [showForm,     setShowForm]  = useState(false)
  const [editingId,    setEditingId] = useState(null)
  const [tempId,       setTempId]    = useState(null) // temp UUID for pre-save image uploads
  const [expandedId,   setExpandedId] = useState(null)
  const [useDateRange, setUseDateRange] = useState(true)
  const [customFrom,   setCustomFrom] = useState(dateFrom)
  const [customTo,     setCustomTo]  = useState(dateTo)
  const [saving,       setSaving]    = useState(false)
  const [deleting,     setDeleting]  = useState(null)
  const [formImages,   setFormImages] = useState([])
  const [expandedNotes, setExpandedNotes] = useState(new Set())
  const [aiReport,     setAiReport]   = useState(null)
  const [aiLoading,    setAiLoading]  = useState(false)
  const [aiError,      setAiError]    = useState(null)
  const [entryAI,      setEntryAI]    = useState({}) // { [id]: { loading, result, error } } // persists across re-renders during form session

  const fmtU = (n,d=0) => (n>=0?'+':'')+n.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:d,maximumFractionDigits:d})
  const genTempId = () => 'temp_' + Date.now() + '_' + Math.random().toString(36).slice(2)
  const emptyForm = { symbol:'', direction:'Long', entry_time:'', exit_time:'', entry_price:'', exit_price:'', position_size_usd:'', reason_missed:'', confidence_level:'', notes:'' }
  const [form, setForm] = useState(emptyForm)

  const activeFrom = useDateRange ? dateFrom : customFrom
  const activeTo   = useDateRange ? dateTo   : customTo

  useEffect(() => { loadMissed() }, [activeFrom, activeTo])

  const loadMissed = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (activeFrom) params.set('from', activeFrom + 'T00:00:00Z')
      if (activeTo)   params.set('to',   activeTo   + 'T23:59:59Z')
      const res  = await fetch('/api/missed-trades?' + params)
      const data = await res.json()
      setMissed(data.missed_trades || [])
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  const openNew  = () => { setForm(emptyForm); setEditingId(null); setTempId(genTempId()); setFormImages([]); setShowForm(true) }
  const openEdit = (m) => {
    setForm({
      symbol: m.symbol||'', direction: m.direction||'Long',
      entry_time: m.entry_time?.slice(0,16)||'', exit_time: m.exit_time?.slice(0,16)||'',
      entry_price: m.entry_price||'', exit_price: m.exit_price||'',
      position_size_usd: m.position_size_usd||'', reason_missed: m.reason_missed||'',
      confidence_level: m.confidence_level||'', notes: m.notes||'',
    })
    setEditingId(m.id); setTempId(null); setFormImages([]); setShowForm(true)
  }
  const cancelForm = () => { setShowForm(false); setEditingId(null); setTempId(null); setFormImages([]) }

  const handleSave = async () => {
    if (!form.symbol || !form.direction) return
    setSaving(true)
    try {
      const body = {
        ...form,
        entry_price:       form.entry_price       ? parseFloat(form.entry_price)       : null,
        exit_price:        form.exit_price        ? parseFloat(form.exit_price)        : null,
        position_size_usd: form.position_size_usd ? parseFloat(form.position_size_usd) : null,
        confidence_level:  form.confidence_level  ? parseInt(form.confidence_level)    : null,
        entry_time:        form.entry_time        ? new Date(form.entry_time).toISOString() : null,
        exit_time:         form.exit_time         ? new Date(form.exit_time).toISOString()  : null,
        temp_id:           tempId || null,
      }
      if (editingId) body.id = editingId
      const res  = await fetch('/api/missed-trades', { method: editingId ? 'PATCH' : 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
      const data = await res.json()
      if (data.missed_trade) {
        const saved = data.missed_trade
        if (editingId) {
          setMissed(prev => prev.map(m => m.id === editingId ? saved : m))
        } else {
          // Always add to top of list regardless of date filter
          setMissed(prev => [saved, ...prev])
          setExpandedId(saved.id)
        }
      }
      setShowForm(false); setEditingId(null); setTempId(null); setForm(emptyForm)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this passed trade?')) return
    setDeleting(id)
    try {
      await fetch('/api/missed-trades?id=' + id, { method:'DELETE' })
      setMissed(prev => prev.filter(m => m.id !== id))
      if (expandedId === id) setExpandedId(null)
    } catch(e) { console.error(e) }
    setDeleting(null)
  }

  const totalMissedPnl = missed.reduce((s,m) => s + (m.hypothetical_pnl_usd || 0), 0)
  const totalActualPnl = visibleTrades.reduce((s,t) => s + (t.pnl || 0), 0)
  const missedWins     = missed.filter(m => (m.hypothetical_pnl_usd||0) > 0).length
  const missedWr       = missed.length ? (missedWins/missed.length*100).toFixed(1) : null
  const actualWr       = visibleTrades.length ? (visibleTrades.filter(t=>t.pnl>0).length/visibleTrades.length*100).toFixed(1) : null

  const previewPnl = (() => {
    const ep = parseFloat(form.entry_price), xp = parseFloat(form.exit_price), sz = parseFloat(form.position_size_usd)
    if (!ep || !xp || !sz || ep <= 0) return null
    const pct = form.direction === 'Long' ? (xp/ep - 1) : (ep/xp - 1)
    return { pct: pct*100, usd: pct*sz }
  })()

  const generateAI = async () => {
    if (!missed.length) return
    setAiLoading(true); setAiError(null)
    try {
      const res  = await fetch('/api/ai-coach', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ mode:'passed_portfolio', passed: missed, actual: visibleTrades }),
      })
      const data = await res.json()
      if (data.error) setAiError(data.error)
      else setAiReport(data)
    } catch(e) { setAiError('AI analysis failed — check your connection') }
    setAiLoading(false)
  }

  const generateEntryAI = async (m) => {
    setEntryAI(prev => ({...prev, [m.id]: {loading:true, result:null, error:null}}))
    try {
      const res  = await fetch('/api/ai-coach', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ mode:'passed_entry', passed: m, actual_wr: visibleTrades.length ? visibleTrades.filter(t=>t.pnl>0).length/visibleTrades.length : null }),
      })
      const data = await res.json()
      if (data.error) setEntryAI(prev => ({...prev, [m.id]: {loading:false, result:null, error:data.error}}))
      else            setEntryAI(prev => ({...prev, [m.id]: {loading:false, result:data, error:null}}))
    } catch(e) { setEntryAI(prev => ({...prev, [m.id]: {loading:false, result:null, error:e.message}})) }
  }

  const TYPE_CFG = {
    critical:    { pillClass:'pr', borderColor:'var(--ls)' },
    bias:        { pillClass:'pw', borderColor:'var(--wa)' },
    opportunity: { pillClass:'pa', borderColor:'var(--ac)' },
    strength:    { pillClass:'pb', borderColor:'var(--wn)' },
  }

  return (
    <div className="anim">
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:8,marginBottom:14}}>
        {[
          ['PASSED P&L',    missed.length ? fmtU(Math.round(totalMissedPnl)) : '—', totalMissedPnl>=0?'pos':'neg', 'Hypothetical', true],
          ['ACTUAL P&L',    fmtU(Math.round(totalActualPnl)), totalActualPnl>=0?'pos':'neg', 'Same period', true],
          ['OPP COST',      missed.length && totalMissedPnl>0 ? fmtU(Math.round(totalMissedPnl)) : '—', 'neg', 'Left on table', true],
          ['PASSED TRADES', String(missed.length), 'neu', missedWins + ' would-be wins', false],
          ['PASSED WIN RATE', missedWr ? missedWr+'%' : '—', 'acc', 'vs '+(actualWr||'—')+'% actual', false],
        ].map(([l,v,c,s,priv])=>(
          <div key={l} className="kpi">
            <div className="kl">{l}</div>
            <div className={'kv '+c+(priv?' private':'')}>{v}</div>
            <div className="ks">{s}</div>
          </div>
        ))}
      </div>

      {/* ── AI ANALYSIS CARD ──────────────────────────────────────────── */}
      <div className="card" style={{marginBottom:14}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:16,flexWrap:'wrap'}}>
          <div style={{flex:1}}>
            <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.08em',fontFamily:'var(--font-mono)',marginBottom:4}}>AI DECISION QUALITY ANALYSIS</div>
            <div style={{fontSize:13,fontWeight:700,marginBottom:4}}>Are your passes adding or destroying value?</div>
            <div style={{fontSize:12,color:'var(--mu)',lineHeight:1.6,marginBottom:12}}>
              Analyses your passed trades vs actual trades to determine if your hesitation is disciplined or fearful.
            </div>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              <button className={`btn ${aiLoading?'':'btn-p'}`} onClick={generateAI} disabled={aiLoading||!missed.length}
                style={{padding:'8px 20px',fontSize:13}}>
                {aiLoading
                  ? <><span style={{width:14,height:14,border:'2px solid var(--bd2)',borderTop:'2px solid var(--ac)',borderRadius:'50%',display:'inline-block',animation:'spin 1s linear infinite'}} /> Analysing {missed.length} passed trades…</>
                  : aiReport ? '🔄 Regenerate Analysis' : '🧠 Analyse My Pass Decisions'}
              </button>
              {!missed.length && <span style={{fontSize:11,color:'var(--mu)'}}>Log some passed trades first.</span>}
            </div>
          </div>
          {aiReport && (
            <div style={{textAlign:'center',padding:'12px 20px',borderLeft:'1px solid var(--bd)',flexShrink:0}}>
              <div style={{fontFamily:'var(--font-mono)',fontSize:48,fontWeight:700,color:'var(--ac)',lineHeight:1}}>{aiReport.score??'—'}</div>
              <div style={{fontSize:10,fontWeight:600,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',marginTop:2}}>DECISION QUALITY</div>
              {aiReport.discipline_rating && (
                <div style={{marginTop:8,padding:'3px 10px',background:'var(--ac-bg)',border:'1px solid var(--ac-bd)',borderRadius:5,fontSize:11,color:'var(--ac2)',fontWeight:600}}>
                  {aiReport.discipline_rating}
                </div>
              )}
            </div>
          )}
        </div>

        {aiReport?.verdict && (
          <div style={{marginTop:14,paddingTop:14,borderTop:'1px solid var(--bd)',display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}} className="g2">
            <div style={{background:'var(--sf2)',border:'1px solid var(--bd)',borderRadius:7,padding:'10px 14px'}}>
              <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:4}}>VERDICT</div>
              <div style={{fontSize:12,color:'var(--tx2)',lineHeight:1.6}}>{aiReport.verdict}</div>
            </div>
            <div style={{background:'var(--sf2)',border:'1px solid var(--bd)',borderRadius:7,padding:'10px 14px'}}>
              <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:4}}>OPPORTUNITY COST</div>
              <div style={{fontSize:12,color:'var(--tx2)',lineHeight:1.6}}>{aiReport.opportunity_cost}</div>
            </div>
          </div>
        )}

        {aiReport?.coaching_tip && (
          <div style={{marginTop:10,padding:'10px 14px',background:'var(--ac-bg)',border:'1px solid var(--ac-bd)',borderRadius:7}}>
            <div style={{fontSize:10,fontWeight:700,color:'var(--ac2)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:4}}>💡 COACHING TIP</div>
            <div style={{fontSize:12,color:'var(--ac2)',lineHeight:1.6}}>{aiReport.coaching_tip}</div>
          </div>
        )}

        {aiError && (
          <div style={{marginTop:10,background:'var(--wa-bg)',border:'1px solid var(--wa-bd)',borderRadius:7,padding:'10px 14px',fontSize:12,color:'var(--wa-tx)'}}>
            ℹ️ {aiError}
          </div>
        )}

        {aiLoading && (
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:14}} className="g2">
            {[1,2,3,4].map(i=>(
              <div key={i} style={{height:100,background:'var(--sf2)',borderRadius:7,padding:14,border:'1px solid var(--bd)'}}>
                <div style={{width:'40%',height:14,background:'var(--sf3)',borderRadius:4,marginBottom:8,animation:'pulse 1.5s infinite'}} />
                <div style={{width:'85%',height:11,background:'var(--sf3)',borderRadius:4,marginBottom:5,animation:'pulse 1.5s infinite'}} />
                <div style={{width:'70%',height:11,background:'var(--sf3)',borderRadius:4,animation:'pulse 1.5s infinite'}} />
              </div>
            ))}
          </div>
        )}

        {aiReport?.insights?.length > 0 && !aiLoading && (
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:14}} className="g2">
            {aiReport.insights.map((ins,i) => {
              const cfg = TYPE_CFG[ins.type] || TYPE_CFG.opportunity
              return (
                <div key={i} style={{background:'var(--sf2)',border:'1px solid var(--bd)',borderRadius:7,padding:'12px 14px',borderLeft:`3px solid ${cfg.borderColor}`}}>
                  <div style={{marginBottom:6}}><span className={`pill ${cfg.pillClass}`}>{ins.tag||ins.type?.toUpperCase()}</span></div>
                  <div style={{fontWeight:600,fontSize:13,marginBottom:5,color:'var(--tx)'}}>{ins.title}</div>
                  <div style={{fontSize:12,color:'var(--tx2)',lineHeight:1.65,marginBottom:8}}>{ins.body}</div>
                  <div style={{padding:'6px 10px',background:'var(--sf)',borderRadius:5,fontSize:11,color:'var(--tx2)',lineHeight:1.6}}>
                    <span style={{fontWeight:600,color:'var(--tx)'}}>Action: </span>{ins.action}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,flexWrap:'wrap'}}>
        <button className={'preset-btn '+(useDateRange?'active':'')} onClick={()=>setUseDateRange(true)}>Use main range ({datePreset||'Custom'})</button>
        <button className={'preset-btn '+(!useDateRange?'active':'')} onClick={()=>setUseDateRange(false)}>Custom range</button>
        {!useDateRange && (<>
          <input type="date" className="inp date-input" value={customFrom} onChange={e=>setCustomFrom(e.target.value)} style={{padding:'3px 8px'}} />
          <span style={{color:'var(--mu)',fontSize:11}}>→</span>
          <input type="date" className="inp date-input" value={customTo} onChange={e=>setCustomTo(e.target.value)} style={{padding:'3px 8px'}} />
          <button className="btn btn-p btn-sm" onClick={loadMissed}>Apply</button>
        </>)}
        <button className="btn btn-p" style={{marginLeft:'auto'}} onClick={openNew}>+ Log Passed Trade</button>
      </div>

      {showForm && (
        <div className="card" style={{marginBottom:14}}>
          <div className="ct">
            <span className="ind" />{editingId ? 'Edit Passed Trade' : 'Log Passed Trade'}
            <button className="btn btn-sm" style={{marginLeft:'auto'}} onClick={cancelForm}>✕</button>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}} className="g2">
            <div>
              <div className="notes-label">Symbol *</div>
              <input className="inp" style={{width:'100%'}} placeholder="e.g. XAUUSD" value={form.symbol} onChange={e=>setForm(f=>({...f,symbol:e.target.value.toUpperCase()}))} />
            </div>
            <div>
              <div className="notes-label">Direction *</div>
              <select className="inp" style={{width:'100%'}} value={form.direction} onChange={e=>setForm(f=>({...f,direction:e.target.value}))}>
                <option>Long</option><option>Short</option>
              </select>
            </div>
            <div>
              <div className="notes-label">Entry Time</div>
              <input className="inp" style={{width:'100%'}} type="datetime-local" value={form.entry_time} onChange={e=>setForm(f=>({...f,entry_time:e.target.value}))} />
            </div>
            <div>
              <div className="notes-label">Exit Time</div>
              <input className="inp" style={{width:'100%'}} type="datetime-local" value={form.exit_time} onChange={e=>setForm(f=>({...f,exit_time:e.target.value}))} />
            </div>
            <div>
              <div className="notes-label">Entry Price</div>
              <input className="inp" style={{width:'100%',fontFamily:'var(--font-mono)'}} type="number" placeholder="0.00" value={form.entry_price} onChange={e=>setForm(f=>({...f,entry_price:e.target.value}))} />
            </div>
            <div>
              <div className="notes-label">Exit Price</div>
              <input className="inp" style={{width:'100%',fontFamily:'var(--font-mono)'}} type="number" placeholder="0.00" value={form.exit_price} onChange={e=>setForm(f=>({...f,exit_price:e.target.value}))} />
            </div>
            <div>
              <div className="notes-label">Position Size USD</div>
              <input className="inp" style={{width:'100%',fontFamily:'var(--font-mono)'}} type="number" placeholder="e.g. 50000" value={form.position_size_usd} onChange={e=>setForm(f=>({...f,position_size_usd:e.target.value}))} />
            </div>
            <div>
              <div className="notes-label">Hypothetical P&L (auto)</div>
              {previewPnl ? (
                <div style={{padding:'8px 0'}}>
                  <div style={{fontFamily:'var(--font-mono)',fontSize:18,fontWeight:700,color:previewPnl.usd>=0?'var(--wn)':'var(--ls)'}}>
                    {fmtU(Math.round(previewPnl.usd))}
                  </div>
                  <div style={{fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>{previewPnl.pct>=0?'+':''}{previewPnl.pct.toFixed(3)}%</div>
                </div>
              ) : <div style={{fontSize:11,color:'var(--mu)',padding:'8px 0'}}>Enter prices + size to calculate</div>}
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}} className="g2">
            <div>
              <div className="notes-label">Reason Missed (optional)</div>
              <select className="inp" style={{width:'100%'}} value={form.reason_missed} onChange={e=>setForm(f=>({...f,reason_missed:e.target.value}))}>
                <option value="">— Select reason —</option>
                {REASON_OPTIONS.map(r=><option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <div className="notes-label">Confidence Level (optional, 1–5)</div>
              <select className="inp" style={{width:'100%'}} value={form.confidence_level} onChange={e=>setForm(f=>({...f,confidence_level:e.target.value}))}>
                <option value="">— Select —</option>
                {[1,2,3,4,5].map(n=><option key={n} value={n}>{n} — {['Very low','Low','Medium','High','Very high'][n-1]}</option>)}
              </select>
            </div>
          </div>
          <div style={{marginBottom:14}}>
            <div className="notes-label">Notes — stream of consciousness (main content)</div>
            <textarea className="notes-field" rows={5}
              placeholder="What did you see? Why didn't you take it? What were you thinking? How did it play out? Lessons?"
              value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} />
          </div>
          {/* Image uploader — available immediately using temp ID */}
          <div style={{marginBottom:14}}>
            <div className="notes-label">Screenshots (optional — attach before or after saving)</div>
            <ImageGallery entityType="missed_trade" entityId={editingId || tempId} isTempId={!editingId} externalImages={formImages} onImagesChange={setFormImages} />
          </div>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
            <button className="btn" onClick={cancelForm}>Cancel</button>
            <button className="btn btn-p" onClick={handleSave} disabled={saving||!form.symbol}>
              {saving?'💾 Saving…':editingId?'💾 Update':'💾 Save Passed Trade'}
            </button>
          </div>
        </div>
      )}

      {loading && <div style={{color:'var(--mu)',fontSize:12,padding:'20px 0',textAlign:'center'}}>Loading…</div>}

      {!loading && missed.length === 0 && (
        <div style={{textAlign:'center',padding:'48px 20px',color:'var(--mu)'}}>
          <div style={{fontSize:36,marginBottom:12}}>👁</div>
          <div style={{fontWeight:600,fontSize:14,marginBottom:6,color:'var(--tx)'}}>No passed trades logged</div>
          <div style={{fontSize:12,maxWidth:360,margin:'0 auto',lineHeight:1.7}}>
            Start logging trades you saw but didn't take. Over time you'll see your opportunity cost and whether your hesitation is costing or saving you money.
          </div>
          <button className="btn btn-p" style={{marginTop:16}} onClick={openNew}>+ Log your first passed trade</button>
        </div>
      )}

      {!loading && missed.length > 0 && (
        <div style={{display:'grid',gap:8}}>
          {missed.map(m => {
            const isExpanded   = expandedId === m.id
            const pnlPos       = (m.hypothetical_pnl_usd||0) >= 0
            const hasPnl       = m.hypothetical_pnl_usd != null
            const notesLong    = m.notes && m.notes.length > 200
            const notesOpen    = expandedNotes.has(m.id)
            return (
              <div key={m.id} className="card" style={{padding:0,overflow:'hidden'}}>
                <div style={{display:'flex',alignItems:'center',gap:12,padding:'12px 16px',cursor:'pointer',background:isExpanded?'var(--sf2)':'transparent'}}
                  onClick={()=>setExpandedId(isExpanded?null:m.id)}>
                  <span style={{fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:4,color:m.direction==='Long'?'#00b5a3':'#ffb300',background:m.direction==='Long'?'rgba(0,181,163,.12)':'rgba(255,179,0,.12)',border:`1px solid ${m.direction==='Long'?'#00b5a3':'#ffb300'}`,flexShrink:0}}>
                    {m.direction==='Long'?'▲':'▼'} {m.direction}
                  </span>
                  <span style={{fontWeight:700,fontSize:13,color:'var(--tx)'}}>{m.symbol}</span>
                  <span style={{fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>{m.entry_time?.slice(0,16).replace('T',' ')}</span>
                  {hasPnl && <span className="private" style={{fontFamily:'var(--font-mono)',fontSize:12,fontWeight:700,color:pnlPos?'var(--wn)':'var(--ls)',marginLeft:4}}>{pnlPos?'+':''}{Math.abs(Math.round(m.hypothetical_pnl_usd)).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:0})}</span>}
                  {m.reason_missed && <span style={{fontSize:10,color:'var(--mu)',background:'var(--sf3)',padding:'2px 8px',borderRadius:4,border:'1px solid var(--bd)'}}>{m.reason_missed}</span>}
                  {m.confidence_level && <span style={{fontSize:10,color:'var(--ac)',fontFamily:'var(--font-mono)',fontWeight:600}}>★{m.confidence_level}</span>}
                  <div style={{marginLeft:'auto',display:'flex',gap:6,alignItems:'center'}}>
                    <button className="btn btn-sm" onClick={e=>{e.stopPropagation();openEdit(m)}}>✎</button>
                    <button className="btn btn-sm btn-d" disabled={deleting===m.id} onClick={e=>{e.stopPropagation();handleDelete(m.id)}}>{deleting===m.id?'…':'✕'}</button>
                    <span style={{fontSize:10,color:'var(--mu)'}}>{isExpanded?'▲':'▼'}</span>
                  </div>
                </div>
                {isExpanded && (
                  <div style={{padding:'14px 16px',borderTop:'1px solid var(--bd)'}}>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',gap:8,marginBottom:14}}>
                      {[
                        ['ENTRY PX',  m.entry_price?.toLocaleString()||'—', 'var(--tx)'],
                        ['EXIT PX',   m.exit_price?.toLocaleString()||'—',  'var(--tx)'],
                        ['POSITION',  m.position_size_usd ? '$'+Math.round(m.position_size_usd).toLocaleString() : '—', 'var(--tx)'],
                        ['HYPO P&L',  hasPnl ? fmtU(Math.round(m.hypothetical_pnl_usd)) : '—', pnlPos?'var(--wn)':'var(--ls)'],
                        ['HYPO %',    m.hypothetical_pct != null ? (m.hypothetical_pct>=0?'+':'')+m.hypothetical_pct.toFixed(3)+'%' : '—', pnlPos?'var(--wn)':'var(--ls)'],
                        ['CONFIDENCE',m.confidence_level ? '★'+m.confidence_level+'/5' : '—', 'var(--ac)'],
                      ].map(([l,v,c])=>(
                        <div key={l} style={{background:'var(--sf2)',border:'1px solid var(--bd)',borderRadius:6,padding:'8px 10px'}}>
                          <div style={{fontSize:9,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:3}}>{l}</div>
                          <div className="private" style={{fontFamily:'var(--font-mono)',fontSize:13,fontWeight:600,color:c}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    {m.notes && (
                      <div style={{background:'var(--sf2)',border:'1px solid var(--bd)',borderRadius:7,padding:'12px 14px',marginBottom:14}}>
                        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                          <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)'}}>NOTES</div>
                          {notesLong && (
                            <button onClick={()=>setExpandedNotes(prev=>{const n=new Set(prev);notesOpen?n.delete(m.id):n.add(m.id);return n})}
                              style={{fontSize:10,color:'var(--ac)',background:'none',border:'none',cursor:'pointer',fontFamily:'var(--font-mono)',padding:0}}>
                              {notesOpen?'▲ collapse':'▼ expand'}
                            </button>
                          )}
                        </div>
                        <div style={{fontSize:12,color:'var(--tx2)',lineHeight:1.7,whiteSpace:'pre-wrap',wordBreak:'break-word',overflowWrap:'break-word',
                          maxHeight: notesLong && !notesOpen ? '4.8em' : 'none',
                          overflow: notesLong && !notesOpen ? 'hidden' : 'visible',
                          maskImage: notesLong && !notesOpen ? 'linear-gradient(to bottom, black 60%, transparent 100%)' : 'none',
                          WebkitMaskImage: notesLong && !notesOpen ? 'linear-gradient(to bottom, black 60%, transparent 100%)' : 'none',
                        }}>{m.notes}</div>
                        {notesLong && !notesOpen && (
                          <button onClick={()=>setExpandedNotes(prev=>{const n=new Set(prev);n.add(m.id);return n})}
                            style={{fontSize:11,color:'var(--ac)',background:'none',border:'none',cursor:'pointer',padding:'4px 0 0',fontFamily:'var(--font-mono)'}}>
                            Read more…
                          </button>
                        )}
                      </div>
                    )}
                    <div style={{marginBottom:14}}>
                      <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:8}}>SCREENSHOTS</div>
                      <ImageGallery entityType="missed_trade" entityId={String(m.id)} />
                    </div>
                    {/* Per-entry AI analysis */}
                    <div style={{borderTop:'1px solid var(--bd)',paddingTop:14}}>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                        <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)'}}>🧠 AI DECISION ANALYSIS</div>
                        <button className="btn btn-sm btn-p"
                          disabled={entryAI[m.id]?.loading}
                          onClick={()=>generateEntryAI(m)}>
                          {entryAI[m.id]?.loading
                            ? <><span style={{width:10,height:10,border:'2px solid rgba(255,255,255,.4)',borderTop:'2px solid #fff',borderRadius:'50%',display:'inline-block',animation:'spin 1s linear infinite'}} /> Analysing…</>
                            : entryAI[m.id]?.result ? '🔄 Re-analyse' : '🧠 Analyse this decision'}
                        </button>
                      </div>
                      {entryAI[m.id]?.error && (
                        <div style={{fontSize:11,color:'var(--ls)',fontFamily:'var(--font-mono)',marginBottom:8}}>ℹ️ {entryAI[m.id].error}</div>
                      )}
                      {entryAI[m.id]?.result && (() => {
                        const r = entryAI[m.id].result
                        return (
                          <div style={{display:'grid',gap:8}}>
                            {r.verdict && (
                              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}} className="g2">
                                <div style={{background:'var(--sf2)',border:'1px solid var(--bd)',borderRadius:7,padding:'10px 12px'}}>
                                  <div style={{fontSize:9,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:4}}>VERDICT</div>
                                  <div style={{fontSize:12,color:'var(--tx2)',lineHeight:1.6}}>{r.verdict}</div>
                                </div>
                                <div style={{background:'var(--sf2)',border:'1px solid var(--bd)',borderRadius:7,padding:'10px 12px'}}>
                                  <div style={{fontSize:9,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:4}}>DECISION QUALITY</div>
                                  <div style={{fontFamily:'var(--font-mono)',fontSize:20,fontWeight:700,color:'var(--ac)'}}>{r.score??'—'}<span style={{fontSize:11,color:'var(--mu)'}}>/100</span></div>
                                </div>
                              </div>
                            )}
                            {r.insights?.map((ins,i) => {
                              const cfg = TYPE_CFG[ins.type]||TYPE_CFG.opportunity
                              return (
                                <div key={i} style={{background:'var(--sf2)',border:'1px solid var(--bd)',borderRadius:7,padding:'10px 12px',borderLeft:`3px solid ${cfg.borderColor}`}}>
                                  <div style={{marginBottom:5}}><span className={`pill ${cfg.pillClass}`}>{ins.tag||ins.type?.toUpperCase()}</span></div>
                                  <div style={{fontWeight:600,fontSize:12,marginBottom:4,color:'var(--tx)'}}>{ins.title}</div>
                                  <div style={{fontSize:11,color:'var(--tx2)',lineHeight:1.6,marginBottom:6}}>{ins.body}</div>
                                  <div style={{padding:'5px 8px',background:'var(--sf)',borderRadius:4,fontSize:11,color:'var(--tx2)',borderLeft:`2px solid ${cfg.borderColor}`}}>
                                    <span style={{fontWeight:600,color:'var(--tx)'}}>Action: </span>{ins.action}
                                  </div>
                                </div>
                              )
                            })}
                            {r.coaching_tip && (
                              <div style={{padding:'8px 12px',background:'var(--ac-bg)',border:'1px solid var(--ac-bd)',borderRadius:7}}>
                                <div style={{fontSize:9,fontWeight:700,color:'var(--ac2)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:3}}>💡 COACHING TIP</div>
                                <div style={{fontSize:11,color:'var(--ac2)',lineHeight:1.6}}>{r.coaching_tip}</div>
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CoachTab({ stats, tradeCount, datePreset, dateFrom, dateTo }) {
  const [report,    setReport]    = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)
  const [generated, setGenerated] = useState(false)
  const [lastRun,   setLastRun]   = useState(null)
  const [saving,    setSaving]    = useState(false)
  const [savedOk,   setSavedOk]   = useState(false)
  const [history,   setHistory]   = useState([])
  const [showHist,  setShowHist]  = useState(false)
  const [histLoad,  setHistLoad]  = useState(false)
  const periodLabel = datePreset || `${dateFrom} → ${dateTo}`

  const generate = async () => {
    if (!stats) return
    setLoading(true); setError(null); setSavedOk(false)
    try {
      const res  = await fetch('/api/ai-coach', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ mode:'portfolio', stats:{ overview:stats.overview, symbols:stats.symbols, sessions:stats.sessions, daily_dow:stats.daily_dow, hourly:stats.hourly, duration:stats.duration, streaks:stats.streaks } }),
      })
      const data = await res.json()
      if (data.stub)       setError(data.message)
      else if (data.error) setError(data.error)
      else { setReport({...data, period:periodLabel, generatedAt:new Date().toISOString()}); setGenerated(true); setLastRun(new Date().toLocaleTimeString()) }
    } catch(e) { setError('Failed to connect to AI coach — check your API key in Vercel.') }
    setLoading(false)
  }

  const saveReport = async () => {
    if (!report) return
    setSaving(true)
    try {
      const res = await fetch('/api/coach-reports', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ period:periodLabel, date_from:dateFrom, date_to:dateTo, trade_count:tradeCount, score:report.score, archetype:report.archetype, core_edge:report.core_edge, core_weakness:report.core_weakness, coaching_tip:report.coaching_tip, insights:report.insights, provider:report.provider }) })
      if (res.ok) { setSavedOk(true); setTimeout(()=>setSavedOk(false), 3000) }
      else setError('Failed to save report.')
    } catch(e) { setError('Failed to save report.') }
    setSaving(false)
  }

  const loadHistory = async () => {
    setHistLoad(true)
    try { const res=await fetch('/api/coach-reports'); const data=await res.json(); setHistory(data.reports||[]) } catch(e) { console.error(e) }
    setHistLoad(false)
  }
  const toggleHistory = () => { if (!showHist) loadHistory(); setShowHist(h=>!h) }
  const deleteReport  = async (id) => { if (!confirm('Delete this saved report?')) return; await fetch(`/api/coach-reports?id=${id}`,{method:'DELETE'}); setHistory(h=>h.filter(r=>r.id!==id)) }
  const loadSavedReport = (saved) => { setReport({...saved, insights:typeof saved.insights==='string'?JSON.parse(saved.insights):saved.insights}); setGenerated(true); setShowHist(false); setLastRun(null) }

  const exportPDF = () => {
    if (!report) return
    const printWin = window.open('', '_blank')
    const insights = (typeof report.insights==='string'?JSON.parse(report.insights):report.insights)||[]
    const TYPE_COLOR = { critical:'#dc2626', bias:'#d97706', opportunity:'#1a56db', strength:'#059669' }
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>AI Coaching Report</title>
<style>body{font-family:Arial,sans-serif;font-size:13px;color:#0f1117;max-width:900px;margin:0 auto;padding:32px}h1{font-size:22px;margin-bottom:4px}.sub{color:#6b7280;font-size:12px;margin-bottom:24px}.meta{display:flex;gap:24px;margin-bottom:24px;padding:16px;background:#f7f8fa;border-radius:8px;border:1px solid #e2e5ea}.meta-label{font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em}.meta-val{font-size:18px;font-weight:700;color:#1a56db}.edge-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px}.edge-box{padding:12px 16px;border-radius:8px}.edge-win{background:#ecfdf5;border:1px solid #a7f3d0}.edge-los{background:#fef2f2;border:1px solid #fecaca}.edge-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}.tip{padding:12px 16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;margin-bottom:24px}.tip-lbl{font-size:10px;font-weight:700;color:#1e429f;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}.insights{display:grid;grid-template-columns:1fr 1fr;gap:12px}.insight{border-radius:8px;padding:14px;border:1px solid #e2e5ea;page-break-inside:avoid}.ins-tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;margin-bottom:8px;color:#fff}.ins-title{font-weight:700;font-size:13px;margin-bottom:6px}.ins-body{font-size:12px;color:#3a3f4a;line-height:1.6;margin-bottom:10px}.ins-action{font-size:11px;padding:8px 10px;background:#f7f8fa;border-radius:4px;line-height:1.6}.footer{margin-top:32px;padding-top:16px;border-top:1px solid #e2e5ea;font-size:11px;color:#9ca3af}@media print{body{padding:16px}}</style></head><body>
<h1>AI Trading Coach Report</h1>
<div class="sub">Period: ${report.period||periodLabel} · ${tradeCount?.toLocaleString()} trades · via ${report.provider==='claude'?'Claude (Anthropic)':'Qwen-Plus'}</div>
<div class="meta"><div class="meta-item"><div class="meta-label">Consistency Score</div><div class="meta-val">${report.score??'—'}/100</div></div>${report.archetype?`<div class="meta-item"><div class="meta-label">Trader Archetype</div><div class="meta-val" style="font-size:14px">${report.archetype}</div></div>`:''}</div>
${report.core_edge?`<div class="edge-grid"><div class="edge-box edge-win"><div class="edge-lbl" style="color:#065f46">✅ Core Edge</div><div style="color:#065f46">${report.core_edge}</div></div><div class="edge-box edge-los"><div class="edge-lbl" style="color:#991b1b">⚠ Core Weakness</div><div style="color:#991b1b">${report.core_weakness}</div></div></div>`:''}
${report.coaching_tip?`<div class="tip"><div class="tip-lbl">💡 This Week's Focus</div><div style="color:#1e429f">${report.coaching_tip}</div></div>`:''}
<div class="insights">${insights.map(ins=>{const c=TYPE_COLOR[ins.type]||'#6b7280';return`<div class="insight" style="border-left:3px solid ${c}"><span class="ins-tag" style="background:${c}">${ins.tag||ins.type?.toUpperCase()}</span><div class="ins-title">${ins.title}</div><div class="ins-body">${ins.body}</div><div class="ins-action"><strong>Action:</strong> ${ins.action}</div></div>`}).join('')}</div>
<div class="footer">Trading Journal · AI Coaching Report · ${report.period||periodLabel}</div>
</body></html>`
    printWin.document.write(html); printWin.document.close(); printWin.onload=()=>printWin.print()
  }

  const TYPE_CFG = {
    critical:    { pillClass:'pr', borderColor:'var(--ls)', icClass:'ic-cr' },
    bias:        { pillClass:'pw', borderColor:'var(--wa)', icClass:'ic-bi' },
    opportunity: { pillClass:'pa', borderColor:'var(--ac)', icClass:'ic-op' },
    strength:    { pillClass:'pb', borderColor:'var(--wn)', icClass:'ic-st' },
  }
  const providerLabel   = report?.provider==='claude'?'Claude (Anthropic)':report?.provider==='qwen'?'Qwen-Plus':''
  const displayInsights = report?.insights?(typeof report.insights==='string'?JSON.parse(report.insights):report.insights):[]

  return (
    <div className="anim">
      <div className="card" style={{marginBottom:14}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:20,flexWrap:'wrap'}}>
          <div style={{flex:1}}>
            <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.08em',fontFamily:'var(--font-mono)',marginBottom:4}}>AI TRADING COACH · LIVE REPORT</div>
            <div style={{fontSize:15,fontWeight:700,marginBottom:2}}>Performance Analysis · {tradeCount?.toLocaleString()||0} Trades</div>
            <div style={{fontSize:11,color:'var(--ac)',fontFamily:'var(--font-mono)',fontWeight:600,marginBottom:8}}>Period: {periodLabel}</div>
            <div style={{fontSize:12,color:'var(--mu)',lineHeight:1.6,maxWidth:520,marginBottom:12}}>Change the date range at the top of the page first, then generate a report for that specific period.</div>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
              <button className={`btn ${loading?'':'btn-p'}`} onClick={generate} disabled={loading||!stats} style={{padding:'8px 20px',fontSize:13,gap:8}}>
                {loading?(<><span style={{width:14,height:14,border:'2px solid var(--bd2)',borderTop:'2px solid var(--ac)',borderRadius:'50%',display:'inline-block',animation:'spin 1s linear infinite'}} /> Analysing {tradeCount?.toLocaleString()} trades…</>):generated?'🔄 Regenerate':'🧠 Generate AI Coaching Report'}
              </button>
              {report && (<>
                <button className="btn" onClick={saveReport} disabled={saving} style={{gap:6}}>{saving?'💾 Saving…':savedOk?'✅ Saved!':'💾 Save Report'}</button>
                <button className="btn" onClick={exportPDF} style={{gap:6}}>📄 Export PDF</button>
              </>)}
              <button className="btn" onClick={toggleHistory} style={{gap:6,marginLeft:'auto'}}>📋 {showHist?'Hide':'View'} Saved Reports</button>
            </div>
            {lastRun&&!loading&&<div style={{fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)',marginTop:8}}>Generated: {lastRun} · via {providerLabel} · period: {periodLabel}</div>}
            {!stats&&<div style={{fontSize:11,color:'var(--mu)',marginTop:8}}>Upload trades first to enable AI analysis.</div>}
          </div>
          {report&&(
            <div style={{textAlign:'center',padding:'12px 24px',borderLeft:'1px solid var(--bd)',flexShrink:0}}>
              <div style={{fontFamily:'var(--font-mono)',fontSize:52,fontWeight:700,color:'var(--ac)',lineHeight:1}}>{report.score??'—'}</div>
              <div style={{fontSize:10,fontWeight:600,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',marginTop:2}}>CONSISTENCY</div>
              {report.archetype&&<div style={{marginTop:10,padding:'4px 10px',background:'var(--ac-bg)',border:'1px solid var(--ac-bd)',borderRadius:5,fontSize:11,color:'var(--ac2)',fontWeight:600}}>{report.archetype}</div>}
              {report.score_rationale&&<div style={{fontSize:10,color:'var(--mu)',marginTop:6,maxWidth:140,lineHeight:1.4}}>{report.score_rationale}</div>}
            </div>
          )}
        </div>
        {report?.core_edge&&(
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:14,paddingTop:14,borderTop:'1px solid var(--bd)'}} className="g2">
            <div style={{background:'var(--wn-bg)',border:'1px solid var(--wn-bd)',borderRadius:7,padding:'10px 14px'}}>
              <div style={{fontSize:10,fontWeight:700,color:'var(--wn-tx)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:4}}>✅ CORE EDGE</div>
              <div style={{fontSize:12,color:'var(--wn-tx)',lineHeight:1.6}}>{report.core_edge}</div>
            </div>
            <div style={{background:'var(--ls-bg)',border:'1px solid var(--ls-bd)',borderRadius:7,padding:'10px 14px'}}>
              <div style={{fontSize:10,fontWeight:700,color:'var(--ls-tx)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:4}}>⚠ CORE WEAKNESS</div>
              <div style={{fontSize:12,color:'var(--ls-tx)',lineHeight:1.6}}>{report.core_weakness}</div>
            </div>
          </div>
        )}
        {report?.coaching_tip&&(
          <div style={{marginTop:12,padding:'10px 14px',background:'var(--ac-bg)',border:'1px solid var(--ac-bd)',borderRadius:7}}>
            <div style={{fontSize:10,fontWeight:700,color:'var(--ac2)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:4}}>💡 THIS WEEK'S FOCUS</div>
            <div style={{fontSize:12,color:'var(--ac2)',lineHeight:1.6}}>{report.coaching_tip}</div>
          </div>
        )}
      </div>

      {showHist&&(
        <div className="card" style={{marginBottom:14}}>
          <div className="ct"><span className="ind" />SAVED REPORTS {histLoad&&<span style={{fontSize:10,fontWeight:400,color:'var(--mu)'}}>Loading…</span>}</div>
          {history.length===0&&!histLoad&&<div style={{color:'var(--mu)',fontSize:12,padding:'8px 0'}}>No saved reports yet. Generate a report and click "Save Report" to keep a record.</div>}
          {history.length>0&&(
            <div style={{display:'grid',gap:8}}>
              {history.map(r=>(
                <div key={r.id} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 12px',background:'var(--sf2)',borderRadius:7,border:'1px solid var(--bd)'}}>
                  <div style={{flex:1}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:2}}>
                      <span style={{fontFamily:'var(--font-mono)',fontSize:13,fontWeight:700,color:'var(--ac)'}}>{r.score}</span>
                      <span style={{fontSize:12,fontWeight:600}}>{r.period}</span>
                      {r.archetype&&<span style={{fontSize:10,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>{r.archetype}</span>}
                    </div>
                    <div style={{fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>{new Date(r.created_at).toLocaleString()} · {r.trade_count?.toLocaleString()} trades · {r.provider==='claude'?'Claude':'Qwen'}</div>
                  </div>
                  <button className="btn btn-sm" onClick={()=>loadSavedReport(r)}>Load</button>
                  <button className="btn btn-sm btn-d" onClick={()=>deleteReport(r.id)}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error&&<div style={{background:'var(--wa-bg)',border:'1px solid var(--wa-bd)',borderRadius:8,padding:'14px 16px',marginBottom:14,fontSize:12,color:'var(--wa-tx)',lineHeight:1.6}}>ℹ️ {error}</div>}

      {loading&&(
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}} className="g2">
          {[1,2,3,4,5,6,7,8].map(i=>(
            <div key={i} className="ic" style={{minHeight:140}}>
              <div style={{width:'40%',height:18,background:'var(--sf3)',borderRadius:4,marginBottom:10,animation:'pulse 1.5s infinite'}} />
              <div style={{width:'80%',height:14,background:'var(--sf3)',borderRadius:4,marginBottom:6,animation:'pulse 1.5s infinite'}} />
              <div style={{width:'90%',height:14,background:'var(--sf3)',borderRadius:4,marginBottom:6,animation:'pulse 1.5s infinite'}} />
              <div style={{width:'70%',height:14,background:'var(--sf3)',borderRadius:4,animation:'pulse 1.5s infinite'}} />
            </div>
          ))}
        </div>
      )}

      {displayInsights.length>0&&!loading&&(
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}} className="g2">
          {displayInsights.map((ins,i)=>{
            const cfg=TYPE_CFG[ins.type]||TYPE_CFG.opportunity
            return (
              <div key={i} className={`ic ${cfg.icClass}`}>
                <div style={{marginBottom:8}}><span className={`pill ${cfg.pillClass}`}>{ins.tag||ins.type?.toUpperCase()}</span></div>
                <div style={{fontWeight:600,fontSize:13,marginBottom:5,color:'var(--tx)'}}>{ins.title}</div>
                <div style={{fontSize:12,color:'var(--tx2)',lineHeight:1.65,marginBottom:10}}>{ins.body}</div>
                <div style={{padding:'8px 10px',background:'var(--sf2)',borderRadius:5,fontSize:11,color:'var(--tx2)',lineHeight:1.6,borderLeft:`2px solid ${cfg.borderColor}`}}>
                  <span style={{fontWeight:600,color:'var(--tx)'}}>Action: </span>{ins.action}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!report&&!loading&&!error&&(
        <div style={{textAlign:'center',padding:'48px 20px',color:'var(--mu)'}}>
          <div style={{fontSize:40,marginBottom:12}}>🧠</div>
          <div style={{fontWeight:600,fontSize:14,marginBottom:6,color:'var(--tx)'}}>Ready to analyse your trading</div>
          <div style={{fontSize:12,maxWidth:420,margin:'0 auto',lineHeight:1.7}}>Select a date range above (WTD, MTD, QTD, YTD, or All), then click Generate. Each report is saved separately so you can compare periods over time.</div>
        </div>
      )}
    </div>
  )
}

