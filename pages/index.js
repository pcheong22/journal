import CoachReportHeader from '../components/CoachReportHeader'
import JournalLoading from '../components/JournalLoading'
import {useDialogFocus} from '../lib/useDialogFocus'
import JournalShell from '../components/JournalShell'
import JournalOverview from '../components/JournalOverview'
import {money,durationLabel} from '../lib/presentation'
import ReviewWorkflow from '../components/ReviewWorkflow'
import {escapeHTML} from '../lib/reportSafety'
import ImportReview, {importRequest} from '../components/ImportReview'
import ImportHistory from '../components/ImportHistory'
import BackupPanel from '../components/BackupPanel'
import { journalFetch } from '../lib/request'
import { useState, useEffect, useRef, useCallback, Component } from 'react'
import Head from 'next/head'
import { computeStats } from '../lib/tradeUtils'
import { isTxFlow } from '../lib/parsers/txflow'
import TxFlowAccountModal from '../components/TxFlowAccountModal'
import { reportingTrade } from '../lib/symbols'
import dynamic from 'next/dynamic'

// Error boundary — catches client-side crashes and shows the error on screen
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if(this.state.error)return <section className="card" role="alert" style={{margin:24,padding:24}}><h2>This view could not be displayed</h2><p>Your saved journal data is unchanged. Retry this view or select another tab.</p><button className="btn btn-p" onClick={()=>this.setState({error:null})}>Retry view</button><button className="btn" onClick={()=>window.location.reload()}>Reload journal</button></section>
    return this.props.children
  }
}
const ChartComp    = dynamic(() => import('../components/Charts'),       { ssr: false })
const TradeModal      = dynamic(() => import('../components/TradeModal'),   { ssr: false })
const SymbolAnalysis = dynamic(() => import('../components/SymbolAnalysis'), { ssr: false })
const EdgeDiscovery   = dynamic(() => import('../components/EdgeDiscovery'),  { ssr: false })
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

export function JournalWorkspace({previewData=null}) {
  const preview=!!previewData
  const [tab,            setTab]            = useState('overview')
  useEffect(()=>{window.scrollTo({top:0,left:0,behavior:'instant'})},[tab])
  const [allTrades,      setAllTrades]      = useState([])
  const [accounts,         setAccounts]         = useState([])
  const [strategies,       setStrategies]       = useState([])
  const [riskOpen,         setRiskOpen]         = useState(false)
  const [rollingOpen,      setRollingOpen]      = useState(false)
  const [acctFilterOpen,   setAcctFilterOpen]   = useState(false)
  const [strategyModal,    setStrategyModal]    = useState(null) // trade being tagged
  const [strategyMgrOpen,  setStrategyMgrOpen]  = useState(false)
  const [tags,           setTags]           = useState([])
  const [stats,          setStats]          = useState(null)
  const requestSequence=useRef(0)
  const [loadError, setLoadError] = useState('')
  const [loading,        setLoading]        = useState(true)
  const [importPreview,setImportPreview]=useState(null)
  const [upload,         setUpload]         = useState({ status:'idle', message:'', broker:'', accountId:'' })
  const [dragOver,       setDragOver]       = useState(false)
  const [hlAccountModal,  setHlAccountModal]  = useState(null) // pending HL native file
  const [hsAccountModal,  setHsAccountModal]  = useState(null) // pending Hypurrscan file
  const [txAccountModal,  setTxAccountModal]  = useState(null)
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
  const [logDetails,setLogDetails]=useState(false)
  const [logFiltersOpen,setLogFiltersOpen]=useState(false)
  const [reviewInbox,setReviewInbox]=useState(false)
  const [reviewSelection,setReviewSelection]=useState(new Set())
  const [fSym,           setFSym]           = useState('')
  const [fDir,           setFDir]           = useState('')
  const [fRes,           setFRes]           = useState('')
  const [fSess,          setFSess]          = useState('')
  const [search,         setSearch]         = useState('')
  const [timingTab,      setTimingTab]      = useState('sessions')
  const [editingAccount, setEditingAccount] = useState(null)
  const [accountOrder,   setAccountOrder]   = useState([])
  const [dragAccId,      setDragAccId]      = useState(null)
  const [showSettings,   setShowSettings]   = useState(false)
  const [acctStatsOpen,  setAcctStatsOpen]  = useState(false)
  const [isClient,       setIsClient]       = useState(false)

  const [settings, setSettings] = useState({
    defaultPrivacy:    false,
    defaultDark:       true,
    defaultDatePreset: 'YTD',
    defaultTab:        'overview',
    acctStatsDefault:  false,
    tradeLogPageSize:  50,
    hlTimezone:        'Asia/Dubai',
    dashboardOrder:    ['kpis','equity','risk','rolling','accounts','charts'],
  })

  const saveSetting = (key, value) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value }
      if (typeof window !== 'undefined') localStorage.setItem('ti_settings', JSON.stringify(next))
      return next
    })
  }

  const PAGE = [50,100,200].includes(settings.tradeLogPageSize)?settings.tradeLogPageSize:50
  useEffect(()=>setPage(0),[PAGE])
  useEffect(()=>setReviewSelection(new Set()),[dateFrom,dateTo,selAccounts,fSym,fDir,fRes,fSess,search,reviewInbox])
  const fileRef = useRef()

  useEffect(() => {
    setIsClient(true)
    try {
      const saved = localStorage.getItem('ti_settings')
      if (saved) {
        const s = JSON.parse(saved)
        setSettings(prev=>({...prev,...s}))
        if (s.defaultPrivacy  !== undefined) setPrivacy(s.defaultPrivacy)
        if (s.defaultDark     !== undefined) setDarkMode(s.defaultDark)
        if (s.acctStatsDefault !== undefined) setAcctStatsOpen(s.acctStatsDefault)
        if (s.defaultTab) setTab(s.defaultTab==='tradelog'?'trades':s.defaultTab)
        if (s.defaultDatePreset && s.defaultDatePreset !== 'YTD') {
          const p = DATE_PRESETS.find(p => p.label === s.defaultDatePreset)
          if (p) { setDatePreset(s.defaultDatePreset); setDateFrom(p.from()); setDateTo(p.to()) }
        }
      }
    } catch(e) {}
  }, [])
  useEffect(() => { document.body.classList.toggle('privacy-on', privacy) }, [privacy])
  useEffect(() => { document.body.classList.toggle('dark-mode', darkMode) }, [darkMode])

  const selectedTrades = allTrades.filter(t => selAccounts.size === 0 || selAccounts.has(t.account_id))
  const visibleTrades = selectedTrades.filter(t=>['USD','USDC','USDT'].includes(t.currency))

  useEffect(() => {
    setStats(computeStats(visibleTrades.filter(t=>['USD','USDC','USDT'].includes(t.currency))))
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
    const enriched = selectedTrades.map(t => {
      let price_pct = null
      if (!t.data_check && t.entry_price && t.exit_price && t.entry_price > 0) {
        price_pct = t.direction === 'Long'
          ? (t.exit_price / t.entry_price - 1) * 100
          : ((t.entry_price - t.exit_price) / t.entry_price) * 100
      }
      return { ...t, price_pct }
    })
    let f = [...enriched]
    if (fSym)  f = f.filter(t => fSym.startsWith('family:') ? t.underlying === fSym.slice(7) : t.symbol === fSym)
    if (fDir)  f = f.filter(t => t.direction === fDir)
    if (fRes === 'source') f = f.filter(t => t.data_check)
    if (fRes === 'win')  f = f.filter(t => t.pnl > 0)
    if(reviewInbox){const reviewed=tags.find(t=>t.name==='Reviewed')?.id;f=f.filter(t=>!t.tag_ids?.includes(reviewed))}
    if(fRes==='breakeven')f=f.filter(t=>t.pnl===0)
    if (fRes === 'loss') f = f.filter(t => t.pnl < 0)
    if (fSess) f = f.filter(t => t.session   === fSess)
    if (search) f = f.filter(t =>
      [t.symbol,t.original_symbol,t.underlying,t.direction,t.exposure_direction,t.session,t.entry_time,t.account_id].join(' ').toLowerCase().includes(search.toLowerCase())
    )
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
  }, [allTrades, selAccounts, fSym, fDir, fRes, fSess, search, sortKey, sortDir,reviewInbox,tags])

  const loadTrades = useCallback(async (from, to) => {
    if(previewData){setAllTrades(previewData.trades.filter(t=>(!from||t.exit_time.slice(0,10)>=from)&&(!to||t.exit_time.slice(0,10)<=to)).map(reportingTrade));setAccounts(previewData.accounts);setTags(previewData.tags);setLoading(false);return}
    const requestId=++requestSequence.current
    setLoading(true); setLoadError('')
    const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),30000)
    try {
      const params = new URLSearchParams()
      if (from && from !== '2000-01-01') params.set('from', from + 'T00:00:00Z')
      if (to)   params.set('to', to + 'T23:59:59.999Z')
      const res  = await journalFetch(`/api/trades?${params}`,{signal:controller.signal})
      const data = await res.json()
      if(requestId!==requestSequence.current)return
      if (data.trades)   setAllTrades(data.trades.map(reportingTrade))
      if (data.accounts) {
        setAccounts(data.accounts)
        // Also refresh strategies
        journalFetch('/api/strategies').then(r=>r.json()).then(d=>{ if(Array.isArray(d)) setStrategies(d) }).catch(()=>{})
        setAccountOrder(prev => {
          const existing = prev.filter(id => data.accounts.find(a => a.id === id))
          const newIds   = data.accounts.filter(a => !prev.includes(a.id)).map(a => a.id)
          return [...existing, ...newIds]
        })
      }
      if (data.tags)     setTags(data.tags)
    } catch(e) {if(requestId===requestSequence.current)setLoadError(e.name==='AbortError'?'Loading took longer than expected. Please retry.':e.message || 'Could not load your journal. Please retry.')}
    finally{clearTimeout(deadline);if(requestId===requestSequence.current)setLoading(false)}
  }, [])

  useEffect(() => {let from=dateFrom,to=dateTo;try{const saved=JSON.parse(localStorage.getItem('ti_settings')||'{}'),preset=DATE_PRESETS.find(p=>p.label===saved.defaultDatePreset);if(preset){from=preset.from();to=preset.to()}}catch{}loadTrades(from,to)}, [])

  const applyPreset = (preset) => {
    const p = DATE_PRESETS.find(p => p.label === preset)
    if (!p) return
    const from = p.from(); const to = p.to()
    setDatePreset(preset); setDateFrom(from); setDateTo(to); setShowCustom(false)
    loadTrades(from, to)
  }
  const applyCustom = () => { setDatePreset('');setShowCustom(false); loadTrades(dateFrom, dateTo) }

  const toggleAccount = id => {
    setSelAccounts(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      if (next.size === accounts.length) return new Set()
      return next
    })
  }
  const selectOnly = id => setSelAccounts(new Set([id]))

  const handleFile = async (file, accountIdOverride = null, timezoneOverride = null) => {
    if (!file) return
    if(file.size>20*1024*1024){setUpload({status:'error',message:'Choose an export smaller than 20 MB.',broker:'',accountId:''});return}
    if (!accountIdOverride) {
      const text = await file.slice(0,65536).text()
      const firstLine = text.split('\n')[0] || ''
      const header = firstLine.replace(/^\uFEFF/, '').split(',').map(value => value.trim().replace(/^"|"$/g, ''))
      if (isTxFlow([header])) {
        setTxAccountModal(file)
        return
      }
      if (firstLine.includes('time,coin,dir,px')) {
        setHlAccountModal(file)
        return
      }
      // Hypurrscan format: class,hash,time,time_iso,token,...
      if (firstLine.startsWith('class,hash,') || firstLine.includes('time_iso')) {
        setHsAccountModal(file)
        return
      }
    }
    setUpload({ status:'uploading', message:`Parsing ${file.name}…`, broker:'', accountId:'' })
    try {
      if(file.size>20*1024*1024)throw new Error('Choose an export smaller than 20 MB.')
      const bytes=await file.arrayBuffer()
      const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('')
      const candidate=await importRequest({action:'upload',filename:file.name,size:file.size,sha})
      if(candidate.url){const response=await fetch(candidate.url,{method:'PUT',headers:{'Content-Type':'application/octet-stream','x-upsert':'false'},body:bytes});if(!response.ok)throw new Error('Export upload failed. Please retry.')}
      const timezone=timezoneOverride || settings.hlTimezone || 'Asia/Dubai'
      const preview=await importRequest({action:'preview',id:candidate.id,accountId:accountIdOverride,timezone})
      setImportPreview({...preview,requestTimezone:timezone})
      setUpload({status:'idle',message:'',broker:'',accountId:''})
    } catch(e) { setUpload({ status:'error', message:e.message, broker:'', accountId:'' }) }
  }
  const handleDrop  = e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]) }
  const handleClear = async (accountId = null) => {
    const expected = accountId ? `DELETE ${accountId}` : 'DELETE ALL'
    const typed = prompt(`${accountId ? 'Delete this account and all its trades?' : 'Delete ALL accounts and their trades?'} This cannot be undone.\n\nType ${expected} to confirm.`)
    if (typed !== expected) return
    try {
      const res = await journalFetch(accountId ? `/api/clear?account=${encodeURIComponent(accountId)}` : '/api/clear', { method:'DELETE', headers: { 'X-Journal-Delete': typed } })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Deletion failed.')
      await loadTrades(dateFrom, dateTo)
      setUpload({ status:'idle', message:'', broker:'', accountId:'' })
    } catch (error) { alert(error.message) }
  }

  const saveAccountLabel = async (id, label, color) => {
    await journalFetch('/api/accounts', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id, label, color }) })
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

  if (!isClient || !allTrades.length&&(loading||loadError)) return <JournalLoading error={loadError} onRetry={()=>loadTrades(dateFrom,dateTo)}/>

  return (
    <>
      <Head>
        <title>Trading Journal · Performance Intelligence</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@300;400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <JournalShell tab={tab} onTab={id=>{setTab(id);if(id==='review')setReviewInbox(true);if(id==='trades')setReviewInbox(false)}} accounts={accounts} selectedAccounts={selAccounts} onAccounts={setSelAccounts}
        datePreset={datePreset} dateFrom={dateFrom} dateTo={dateTo} onPreset={applyPreset} onCustom={(from,to)=>{setDateFrom(from);setDateTo(to);setDatePreset('');loadTrades(from,to)}} count={selectedTrades.length}
        privacy={privacy} onPrivacy={()=>setPrivacy(p=>!p)} dark={darkMode} onTheme={()=>setDarkMode(d=>!d)} onSettings={()=>setShowSettings(true)} onImport={()=>fileRef.current?.click()} preview={preview}/>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={e=>{handleFile(e.target.files?.[0]);e.target.value=''}}/>
      {upload.status!=='idle'&&<div role="status" className="import-status">{upload.message}<button className="text-button" onClick={()=>setUpload({status:'idle',message:''})}>Dismiss</button></div>}
      {editingAccount && <AccountRenameModal account={editingAccount} onSave={saveAccountLabel} onClose={()=>setEditingAccount(null)} />}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          saveSetting={saveSetting}
          privacy={privacy}           setPrivacy={setPrivacy}
          darkMode={darkMode}         setDarkMode={setDarkMode}
          acctStatsOpen={acctStatsOpen} setAcctStatsOpen={setAcctStatsOpen}
          onClose={()=>setShowSettings(false)}
          accounts={accounts} onEditAccount={account=>{setShowSettings(false);setEditingAccount(account)}} onDeleteAccount={handleClear} preview={preview}
        />
      )}
      {importPreview && <ImportReview preview={importPreview} onClose={()=>setImportPreview(null)} onComplete={async result=>{setImportPreview(null);setUpload({status:'success',message:result.warning || `Import complete: ${result.inserted} new, ${result.updated} updated, ${result.removed} duplicates removed, ${result.skipped} unchanged.`,broker:result.broker,accountId:result.accountId});await loadTrades(dateFrom,dateTo)}} />}
      {hlAccountModal && (
        <HyperliquidAccountModal
          onSelect={accountId => { setHlAccountModal(null); handleFile(hlAccountModal, accountId) }}
          onClose={() => setHlAccountModal(null)}
          existingAccounts={accounts.filter(a => a.broker === 'Hyperliquid')}
        />
      )}
      {txAccountModal && (
        <TxFlowAccountModal
          filename={txAccountModal.name}
          defaultTimezone={settings.hlTimezone || 'Asia/Dubai'}
          existingAccounts={accounts.filter(account => account.broker === 'TxFlow')}
          onSelect={(accountId, timezone) => { setTxAccountModal(null); handleFile(txAccountModal, accountId, timezone) }}
          onClose={() => setTxAccountModal(null)}
        />
      )}
      {hsAccountModal && (
        <HypurrscanAccountModal
          onSelect={accountId => { setHsAccountModal(null); handleFile(hsAccountModal, accountId) }}
          onClose={() => setHsAccountModal(null)}
        />
      )}
      {strategyModal && (
        <StrategyTagModal
          trade={strategyModal}
          strategies={strategies}
          onClose={() => setStrategyModal(null)}
          onTagged={async (tradeId, strategyId, newStrategy) => {
            // If new strategy created, refresh strategies list
            if (newStrategy) {
              const r = await journalFetch('/api/strategies', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ name: newStrategy.name, type: newStrategy.type, trade_ids: [tradeId] })
              })
              const d = await r.json()
              setStrategies(prev => [...prev, d.strategy])
            } else {
              await journalFetch(`/api/strategies?id=${strategyId}`, {
                method:'PATCH', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ add_trade_ids: [tradeId] })
              })
            }
            // Update trade locally
            setTrades(prev => prev.map(t => t.id === tradeId
              ? { ...t, strategy_id: newStrategy ? 'pending' : strategyId }
              : t))
            setStrategyModal(null)
          }}
          onUntagged={async (tradeId) => {
            await journalFetch(`/api/strategies?id=untag`, {
              method:'PATCH', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ remove_trade_ids: [tradeId] })
            })
            setTrades(prev => prev.map(t => t.id === tradeId ? { ...t, strategy_id: null } : t))
            setStrategyModal(null)
          }}
        />
      )}
      {strategyMgrOpen && (
        <StrategyManagerModal
          strategies={strategies}
          onClose={() => setStrategyMgrOpen(false)}
          onDeleted={async (id) => {
            await journalFetch(`/api/strategies?id=${id}`, { method:'DELETE' })
            setStrategies(prev => prev.filter(s => s.id !== id))
          }}
          onCreated={async (name, type) => {
            const r = await journalFetch('/api/strategies', {
              method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ name, type })
            })
            const d = await r.json()
            setStrategies(prev => [...prev, d.strategy])
          }}
        />
      )}

      <main style={{padding:'18px 24px',maxWidth:1440,margin:'0 auto',overflowX:'hidden'}}><ErrorBoundary key={tab}>
        {loading&&<p role="status" className="loading-scope">Updating this period…</p>}
        {tab==='overview'&&!stats&&!loading&&<div className="empty-ledger"><h1>No closed trades in this period</h1><p>Choose another reporting period or import an export to get started.</p><button className="btn" onClick={()=>applyPreset('All')}>Show all history</button></div>}
        {loadError && <div role="alert" style={{padding:14,marginBottom:14,border:'1px solid var(--ls)',borderRadius:8,color:'var(--ls)'}}>{loadError} <button className="btn btn-sm" onClick={()=>loadTrades(dateFrom,dateTo)}>Retry loading</button></div>}

        {['overview','portfolio'].includes(tab) && stats && (
          <div className="anim">
          {tab==='overview'&&selectedTrades.length>visibleTrades.length&&<p className="data-check-notice">{selectedTrades.length-visibleTrades.length} trades in other currencies are excluded from dollar analytics and remain available in Trades.</p>}
          {tab==='overview'&&<JournalOverview key={darkMode?'dark':'light'} stats={stats} trades={visibleTrades} tags={tags} privacy={privacy} onReview={()=>{setTab('review');setReviewInbox(true)}} onSourceCheck={()=>{setFSym('');setFDir('');setFRes('source');setFSess('');setSearch('');setReviewInbox(false);setLogFiltersOpen(true);setTab('trades')}} onInstrument={symbol=>{setFSym(symbol);setFDir('');setFRes('');setFSess('');setSearch('');setReviewInbox(false);setTab('trades')}}/>}
          {tab==='portfolio'&&<div className="page-heading"><div><span className="eyebrow">Analysis</span><h1>Portfolio detail</h1><p>Explore closed-trade statistics and account contributions.</p></div></div>}
          {(tab==='portfolio'?['risk','rolling','accounts']:[]).map(section => {
            switch(section) {
              case 'risk': return (
                <div key='risk'>

            {/* ── RISK ANALYTICS (collapsible) ──────────────────────── */}
            {(() => {
              const ov = stats.overview
              // riskOpen state is declared at component level
              const fN  = (n, d=2) => n == null ? '—' : n.toFixed(d)
              const fP  = (n)      => n == null ? '—' : n.toFixed(1) + '%'
              const fU2 = (n)      => n == null ? '—' : (n>=0?'+':'')+n.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0})
              const badge = (val, good, fair) => {
                const label = val == null ? null : val >= good ? 'Good' : val >= fair ? 'Fair' : 'Poor'
                const col   = label === 'Good' ? '#66ffa5' : label === 'Fair' ? '#f0a500' : '#ff5258'
                return label ? <span style={{fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:3,fontFamily:'var(--font-mono)',
                  background:`${col}20`,color:col,border:`1px solid ${col}40`,whiteSpace:'nowrap'}}>{label}</span> : null
              }
              const Tip = ({text, children}) => (
                <span style={{position:'relative',display:'inline-block',cursor:'help'}}
                  onMouseEnter={e=>e.currentTarget.querySelector('.tip').style.display='block'}
                  onMouseLeave={e=>e.currentTarget.querySelector('.tip').style.display='none'}>
                  {children}
                  <span className="tip" style={{display:'none',position:'absolute',bottom:'130%',left:0,
                    background:'var(--sf2)',border:'1px solid var(--bd)',borderRadius:6,padding:'8px 10px',
                    fontSize:10,color:'var(--mu)',width:200,lineHeight:1.5,zIndex:99,whiteSpace:'normal',
                    fontWeight:400,textTransform:'none',letterSpacing:0,boxShadow:'0 4px 20px rgba(0,0,0,.6)',
                    fontFamily:'var(--font-sans)'}}>
                    {text}
                  </span>
                </span>
              )
              const RCard = ({label, val, fmt, bench, good, fair, tip}) => (
                <div style={{background:'var(--sf)',border:'1px solid var(--bd)',borderRadius:8,padding:'12px 14px',
                  display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8}}>
                  <div style={{flex:1}}>
                    <Tip text={tip}>
                      <div style={{fontSize:9,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',
                        letterSpacing:'.08em',fontFamily:'var(--font-mono)',borderBottom:'1px dashed var(--bd)',
                        display:'inline-block',paddingBottom:1,marginBottom:4}}>
                        {label} ⓘ
                      </div>
                    </Tip>
                    <div style={{fontSize:20,fontWeight:700,fontFamily:'var(--font-mono)',margin:'3px 0',
                      color:val==null?'var(--mu)':val>=0?'#66ffa5':'#ff5258'}}>{fmt(val)}</div>
                    <div style={{fontSize:9,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>{bench}</div>
                  </div>
                  {good != null && badge(val, good, fair)}
                </div>
              )
              const GBar = ({label, val, max, color}) => (
                <div style={{marginBottom:10}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                    <span style={{fontSize:9,color:'var(--mu)',fontFamily:'var(--font-mono)',textTransform:'uppercase',letterSpacing:'.05em'}}>{label}</span>
                    <span style={{fontSize:12,fontWeight:700,fontFamily:'var(--font-mono)',color}}>{val == null ? '—' : val < 1 ? '<1%' : val.toFixed(1)+'%'}</span>
                  </div>
                  <div style={{height:5,background:'var(--sf2)',borderRadius:3,overflow:'hidden'}}>
                    <div style={{height:'100%',width:`${Math.min(100,val||0)}%`,background:color,borderRadius:3,transition:'width .4s'}} />
                  </div>
                </div>
              )
              return (
                <div style={{marginBottom:14}}>
                  <button onClick={()=>setRiskOpen(o=>!o)}
                    style={{background:'none',border:'none',cursor:'pointer',color:'var(--mu)',fontSize:10,
                      fontFamily:'var(--font-mono)',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',
                      display:'flex',alignItems:'center',gap:5,padding:'0 0 10px',width:'100%',transition:'color .15s'}}
                    onMouseEnter={e=>e.currentTarget.style.color='var(--tx)'}
                    onMouseLeave={e=>e.currentTarget.style.color='var(--mu)'}>
                    {riskOpen ? '▲' : '▼'} RISK ANALYTICS {riskOpen ? '(collapse)' : '(expand)'}
                    <div style={{flex:1,height:1,background:'var(--bd)',marginLeft:8}} />
                  </button>
                  {riskOpen && (
                    <div style={{display:'grid',gap:10}}>
                      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:8}}>
                       <RCard label="Profit factor" val={ov.profit_factor} fmt={fN} bench="Gross wins ÷ gross losses" good={1.5} fair={1} tip="Descriptive ratio for these closed trades. No gross losses means the ratio is undefined." />
                       <RCard label="P&L recovery" val={ov.recovery_factor} fmt={fN} bench="Net P&L ÷ closed-trade drawdown" good={2} fair={1} tip="Uses realised trade P&L, not account equity or intratrade drawdowns." />
                      </div>
                      <p style={{color:'var(--mu)',fontSize:12,lineHeight:1.7}}>Portfolio Sharpe, Sortino, Calmar and Ulcer metrics require account equity and cash-flow history. These exports do not provide that history. Position-sizing and risk-of-ruin recommendations are unavailable.</p>
                    </div>
                  )}
                </div>
              )
            })()}
                </div>
              )
              case 'rolling': return (
                <div key='rolling'>

            {/* ── ROLLING ANALYTICS (collapsible) ──────────────────────────── */}
            <div style={{marginBottom:14}}>
              <button onClick={()=>setRollingOpen(o=>!o)}
                style={{background:'none',border:'none',cursor:'pointer',color:'var(--mu)',fontSize:10,
                  fontFamily:'var(--font-mono)',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',
                  display:'flex',alignItems:'center',gap:5,padding:'0 0 10px',width:'100%',transition:'color .15s'}}
                onMouseEnter={e=>e.currentTarget.style.color='var(--tx)'}
                onMouseLeave={e=>e.currentTarget.style.color='var(--mu)'}>
                {rollingOpen ? '▲' : '▼'} ROLLING ANALYTICS {rollingOpen ? '(collapse)' : '(expand)'}
                <div style={{flex:1,height:1,background:'var(--bd)',marginLeft:8}} />
              </button>
              {rollingOpen && (
                <div className="card" style={{padding:16}}>
                  <div style={{fontSize:11,color:'var(--mu)',marginBottom:12,lineHeight:1.5}}>
                    Rolling 20-trade and 50-trade expectancy + win rate over time.
                    <span style={{color:'#66ffa5',marginLeft:6}}>Trending up = edge improving.</span>
                    <span style={{color:'#ff5258',marginLeft:6}}>Trending down = edge decaying.</span>
                  </div>
                  <ChartComp type="rolling" trades={visibleTrades} privacy={privacy} />
                </div>
              )}
                </div>
                </div>
              )
              case 'accounts': return (
                <div key='accounts'>

            {accounts.length > 1 && (<div style={{marginBottom:14}}>
                <button onClick={()=>setAcctStatsOpen(o=>!o)}
                  style={{background:'none',border:'none',cursor:'pointer',color:'var(--mu)',fontSize:10,fontFamily:'var(--font-mono)',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',display:'flex',alignItems:'center',gap:5,padding:'0 0 8px',transition:'color .15s'}}
                  onMouseEnter={e=>e.currentTarget.style.color='var(--tx)'}
                  onMouseLeave={e=>e.currentTarget.style.color='var(--mu)'}>
                  {acctStatsOpen ? '▲' : '▼'} ACCOUNT BREAKDOWN {acctStatsOpen ? '(collapse)' : '(expand)'}
                </button>
                {acctStatsOpen && (
                  <div style={{background:'var(--sf)',border:'1px solid var(--bd)',borderRadius:8,overflow:'hidden'}}>
                    {orderedAccounts.map(acc => {
                      const at  = visibleTrades.filter(t=>t.account_id===acc.id)
                      if (!at.length) return null
                      const ap  = at.reduce((s,t)=>s+t.pnl,0)
                      const awr = at.filter(t=>t.pnl>0).length/at.length
                      return (
                        <div key={acc.id}
                          style={{display:'grid',gridTemplateColumns:'1fr 88px 72px',
                            borderBottom:'1px solid var(--sf2)',transition:'background .1s'}}
                          onMouseEnter={e=>e.currentTarget.style.background='var(--sf2)'}
                          onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                          {/* Col 1: dot + name */}
                          <div style={{padding:'7px 10px',display:'flex',alignItems:'center',gap:7,minWidth:0,overflow:'hidden'}}>
                            <span style={{width:7,height:7,borderRadius:'50%',background:acc.color,flexShrink:0}} />
                            <div style={{minWidth:0}}>
                              <div style={{fontSize:11,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{acc.label||acc.id}</div>
                              <div style={{fontSize:9,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>{acc.broker}</div>
                            </div>
                          </div>
                          {/* Col 2: P&L */}
                          <div style={{padding:'7px 8px',display:'flex',alignItems:'center',justifyContent:'flex-end'}}>
                            <span className="private" style={{fontFamily:'var(--font-mono)',fontSize:12,fontWeight:700,
                              color:ap>=0?'var(--wn)':'var(--ls)',whiteSpace:'nowrap'}}>{fU(Math.round(ap))}</span>
                          </div>
                          {/* Col 3: WR · trades */}
                          <div style={{padding:'7px 10px 7px 0',display:'flex',alignItems:'center',justifyContent:'flex-end'}}>
                            <span style={{fontSize:10,color:'var(--mu)',fontFamily:'var(--font-mono)',whiteSpace:'nowrap'}}>
                              {(awr*100).toFixed(1)}%·{at.length}t
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
                </div>
              )
              default: return null
            }
          })}
          </div>        )}

        {tab==='edge' && <div style={{margin:'0 -24px'}}><EdgeDiscovery trades={visibleTrades} stats={stats} strategies={strategies} /></div>}

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
          <SymbolAnalysis trades={visibleTrades} privacy={privacy}
            onSelect={(symbol, family) => { setFSym(family ? `family:${symbol}` : symbol); setFDir(''); setFRes(''); setFSess(''); setSearch(''); setPage(0); setTab('trades') }} />
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
                          <td><span className={`pill ${d.win_rate>=.65?'pb':d.win_rate<.55?'pr':'pw'}`}>{d.win_rate>=.65?'Higher historical WR':d.win_rate<.55?'Lower historical WR':'Middle historical WR'}</span></td>
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

        {['trades','review'].includes(tab) && (
          <div className="anim trade-log-page"><div className="page-heading"><div><span className="eyebrow">{tab==='review'?'Reflect & improve':'Trade history'}</span><h1>{tab==='review'?'Review queue':'Trades'}</h1><p>{tab==='review'?'A deliberate record of what worked, what changed and what comes next.':'Your positions, with the execution detail behind every result.'}</p></div></div>
            <ReviewWorkflow trades={selectedTrades} pageTrades={paged} tags={tags} inbox={reviewInbox} setInbox={setReviewInbox} selection={reviewSelection} setSelection={setReviewSelection}
             onSaved={async updated=>{setAllTrades(prev=>prev.map(t=>{const changed=updated.find(u=>u.id===t.id);return changed?reportingTrade({...t,...changed}):t}));const response=await(await journalFetch('/api/trades?from='+encodeURIComponent(dateFrom+'T00:00:00Z')+'&to='+encodeURIComponent(dateTo+'T23:59:59.999Z'))).json();if(response.tags)setTags(response.tags)}}
             filters={{symbol:fSym,direction:fDir,result:fRes,session:fSess,search,inbox:reviewInbox,accounts:[...selAccounts],from:dateFrom,to:dateTo,sortKey,sortDir}}
             savedViews={settings.savedViews || []} onSaveViews={views=>saveSetting('savedViews',views)}
             onApply={v=>{setFSym(v.symbol||'');setFDir(v.direction||'');setFRes(v.result||'');setFSess(v.session||'');setSearch(v.search||'');setReviewInbox(!!v.inbox);setSelAccounts(new Set(v.accounts||[]));setDateFrom(v.from);setDateTo(v.to);setDatePreset('');setSortKey(v.sortKey||'exit_time');setSortDir(v.sortDir===1?1:-1);setReviewSelection(new Set());loadTrades(v.from,v.to)}}
             preview={preview} onWeekly={()=>{const from=daysAgo(7),to=today();setDateFrom(from);setDateTo(to);setDatePreset('');setFSym('');setFDir('');setFRes('');setFSess('');setSearch('');setReviewInbox(true);setReviewSelection(new Set());loadTrades(from,to)}} />
            <div className="log-hint">Open a trade to inspect executions and record a lesson.</div>
            <div className="log-searchbar"><input aria-label="Search trades" className="inp" placeholder="Search instruments, accounts…" value={search} onChange={e=>setSearch(e.target.value)}/><button className="btn" aria-expanded={logFiltersOpen} onClick={()=>setLogFiltersOpen(v=>!v)}>Filters {fSym||fDir||fRes||fSess?'· active':''}</button><button className="btn columns-button" onClick={()=>setLogDetails(v=>!v)}>{logDetails?'Essential columns':'More columns'}</button><span>{filtered.length.toLocaleString()} trades</span></div>
            {logFiltersOpen&&<>            <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:10,flexWrap:'wrap',background:'var(--sf)',border:'1px solid var(--bd)',borderRadius:8,padding:'10px 14px',boxShadow:'var(--sh-sm)'}}>
              <button className="text-button" onClick={()=>{setFSym('');setFDir('');setFRes('');setFSess('');setSearch('')}}>Reset filters</button>

              <select className="inp" aria-label="Market or underlying family" value={fSym} onChange={event=>setFSym(event.target.value)}>
                <option value="">All symbols and families</option>
                <optgroup label="Underlying families">{['Crude oil','Bitcoin'].filter(family=>visibleTrades.some(trade=>trade.underlying===family)).map(family=><option key={family} value={`family:${family}`}>{family} — all products</option>)}</optgroup>
                <optgroup label="Markets / products">{symbols.map(symbol=><option key={symbol}>{symbol}</option>)}</optgroup>
              </select>
              {[[fDir,setFDir,['Long & Short','Long','Short']],[fRes,setFRes,['All outcomes','win','loss','breakeven','source']],[fSess,setFSess,['All Sessions','Asia','London','London/NY Overlap','New York']]].map(([val,setter,opts],i)=>(
                <select key={i} aria-label={['Direction','Outcome','Trading session'][i]} className="inp" value={val} onChange={e=>setter(e.target.value)}>
                  {opts.map((o,j)=><option key={o} value={j===0?'':o}>{o==='source'?'Source check':o}</option>)}
                </select>
              ))}
              <span style={{marginLeft:'auto',fontFamily:'var(--font-mono)',fontSize:11,color:'var(--mu)'}}>
                <strong style={{color:'var(--tx)'}}>{filtered.length.toLocaleString()}</strong> trades
              </span>
            </div>
</>}
            {!loading&&filtered.length===0&&<p role="status" className="data-check-notice">{fRes==='source'?'No source-check warnings match this scope.':'No trades match these filters.'} Use Reset filters or choose another reporting period.</p>}
            <div className="mobile-trade-list">{paged.map(t=><div className="mobile-trade-row" key={t.id}><input type="checkbox" aria-label={`Select ${t.symbol} mobile trade ${t.id}`} checked={reviewSelection.has(t.id)} onChange={e=>setReviewSelection(prev=>{const next=new Set(prev);if(e.target.checked&&next.size<200)next.add(t.id);else next.delete(t.id);return next})}/><button className="mobile-trade" onClick={()=>setSelected(t)}><span><strong>{t.symbol}</strong><small>{t.direction} · {t.entry_time?.slice(0,10)||'Unknown date'}</small></span><span><strong className={'private '+(t.pnl>=0?'positive':'negative')}>{['USD','USDC','USDT'].includes(t.currency)?money(t.pnl):`${t.pnl.toLocaleString()} ${t.currency||'unknown currency'}`}</strong><small>{t.data_check?'Source check':durationLabel(t.duration_mins)} · Open ↗</small></span></button></div>)}</div>
            <div className="card" style={{padding:0,overflow:'hidden'}}>
              <div className="tw trade-tbl-wrap ledger-trades">
                <table style={{minWidth:850}}>
                  <thead><tr><th scope="col">Select</th>
                    {[['symbol','Instrument'],['pnl','Reported P&L'],['entry_time','Opened · UTC'],['account_id','Account'],['duration_mins','Duration'],['pct_gain','Price move'],['execution_count','Fills'],['_notes','Review'],...(logDetails?[['exit_time','Closed · UTC'],['entry_price','Avg entry'],['exit_price','Avg exit'],['notional_usd','Estimated notional'],['session','Session'],['_strategy','Strategy']]:[])].map(([k,l])=>(
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
                        <tr key={t.id||i} className="clk" tabIndex={0} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();setSelected(t)}}} onClick={()=>setSelected(t)}>
                          <td onClick={e=>e.stopPropagation()}><input type="checkbox" aria-label={`Select ${t.symbol} trade ${t.id}`} checked={reviewSelection.has(t.id)} onChange={e=>setReviewSelection(prev=>{const next=new Set(prev);if(e.target.checked&&next.size<200)next.add(t.id);else next.delete(t.id);return next})}/></td>
                          <td className="instrument-cell"><strong>{t.symbol}</strong><span>{t.direction}{t.data_check&&<span className="data-check-label" title={t.data_check}> · Source check</span>}</span></td>
                          <td className={'numeric private '+(t.pnl>=0?'positive':'negative')}>{['USD','USDC','USDT'].includes(t.currency)?money(t.pnl):`${t.pnl.toLocaleString()} ${t.currency || 'unknown currency'}`}</td>
                          <td className="date-cell">{t.entry_time?.slice(0,10)||'Unknown'}<small>{t.entry_time?.slice(11,16)}</small></td>
                          <td className="account-cell" title={t.account_id}>{acc?.label||t.broker}<small>{t.broker}</small></td>
                          <td className="numeric">{durationLabel(t.duration_mins)}</td>
                          <td className="numeric">{t.data_check?<span title={t.data_check}>Check source</span>:pctStr}</td>
                          <td className="numeric">{t.execution_count?<span className="fill-link">{t.execution_count} ↗</span>:'—'}</td>
                          <td><span className={'review-state '+(t.tag_ids?.includes(tags.find(tag=>tag.name==='Reviewed')?.id)?'complete':'')}>{t.tag_ids?.includes(tags.find(tag=>tag.name==='Reviewed')?.id)?'Reviewed':hasNotes?'Draft notes':'To review'}</span></td>
                          {logDetails&&<><td>{t.exit_time?.slice(0,16).replace('T',' ')||'Unknown'}</td><td className="numeric">{t.entry_price?.toLocaleString()||'—'}</td><td className="numeric">{t.exit_price?.toLocaleString()||'—'}</td><td className="numeric private">{t.notional_usd?money(t.notional_usd,{signed:false}):'—'}</td><td>{t.session}</td><td><button className="text-button" onClick={e=>{e.stopPropagation();if(!preview)setStrategyModal(t)}}>{strategies.find(strategy=>strategy.id===t.strategy_id)?.name || 'Assign strategy'}</button></td></>}

                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{display:'flex',gap:8,alignItems:'center',padding:'10px 14px',borderTop:'1px solid var(--bd)',background:'var(--sf2)'}}>
                <button className="btn" disabled={page===0} onClick={()=>setPage(p=>p-1)}>← Prev</button>
                <span style={{fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>{filtered.length?page*PAGE+1:0}–{Math.min((page+1)*PAGE,filtered.length)} of {filtered.length}</span>
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

            <div style={{fontWeight:700,fontSize:14,marginBottom:8,color:'var(--tx)'}}>No trades loaded</div>
            <div style={{fontSize:12,color:'var(--mu)'}}>Use Import trades in the header to add a supported broker export.</div>
          </div>
        )}
      </ErrorBoundary></main>

      {selected && (
        <TradeModal
          trade={selected} preview={preview}
          onClose={()=>setSelected(null)}
          trades={filtered}
          onNavigate={t=>setSelected(t)}
          tags={tags}
          onSaved={updated => { setAllTrades(prev => prev.map(t => t.id === updated.id ? reportingTrade({ ...t, ...updated }) : t)); setSelected(prev => prev?.id === updated.id ? reportingTrade({ ...prev, ...updated }) : prev) }}
        />
      )}
    </>
  )
}

export default function Dashboard() {
  return <ErrorBoundary><JournalWorkspace /></ErrorBoundary>
}

const HL_ACCOUNTS = [
  { id:'0xffbB07326634300D7ef131E2B5826Dcb49c0C8E0', label:'Hyperliquid 0xffbB....C8E0' },
  { id:'0x68e68A0355f80145Fb745A1419002db7ba7f7d8e', label:'Hyperliquid 0x68e6....7d8e' },
  { id:'0x950793403DFaA533c7ef84E81272bf94f5b46466', label:'Hyperliquid 0x9507....6466' },
]

function HypurrscanAccountModal({ onSelect, onClose }) {
  const [custom, setCustom] = useState('')
  const [showCustom, setShowCustom] = useState(false)

  return (
    <div className="mo" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:'var(--sf)',border:'1px solid var(--bd)',borderRadius:10,padding:24,width:420,boxShadow:'var(--sh-lg)',margin:'auto'}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>Which Hyperliquid account? (Hypurrscan)</div>
        <div style={{fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)',marginBottom:18}}>
          Select the account this Hypurrscan export belongs to
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


// ── STRATEGY TAG MODAL ────────────────────────────────────────────────────────
// Shown when clicking the Strategy cell on a trade row
// Lets user assign trade to existing strategy or create a new one
function StrategyTagModal({ trade, strategies, onClose, onTagged, onUntagged }) {
  const [mode, setMode]   = useState('pick') // 'pick' | 'new'
  const [name, setName]   = useState('')
  const [type, setType]   = useState('delta_neutral')
  const [busy, setBusy]   = useState(false)

  const handle = async (strategyId) => {
    setBusy(true)
    try { await onTagged(trade.id, strategyId, null) } catch(e) { alert(e.message) } finally { setBusy(false) }
  }

  const handleNew = async () => {
    if (!name.trim()) return
    setBusy(true)
    try { await onTagged(trade.id, null, { name: name.trim(), type }) } catch(e) { alert(e.message) } finally { setBusy(false) }
  }

  const handleUntag = async () => {
    setBusy(true)
    try { await onUntagged(trade.id) } catch(e) { alert(e.message) } finally { setBusy(false) }
  }

  const TYPES = ['delta_neutral','carry','arb','basket','other']

  return (
    <div className="mo" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:'var(--sf)',border:'1px solid var(--bd)',borderRadius:10,padding:24,width:400,boxShadow:'var(--sh-lg)',margin:'auto'}}>
        <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>Tag Strategy</div>
        <div style={{fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)',marginBottom:16}}>
          {trade.symbol} · {trade.direction} · {trade.exit_time?.slice(0,10)}
        </div>

        {trade.strategy_id && (
          <div style={{marginBottom:14,padding:'8px 12px',background:'rgba(102,255,165,.06)',border:'1px solid rgba(102,255,165,.2)',borderRadius:6,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:11,color:'#66ffa5'}}>
              Currently: {strategies.find(s=>s.id===trade.strategy_id)?.name||'Tagged'}
            </span>
            <button onClick={handleUntag} disabled={busy}
              style={{fontSize:10,background:'none',border:'1px solid var(--bd)',borderRadius:4,color:'var(--mu)',cursor:'pointer',padding:'2px 8px'}}>
              Remove tag
            </button>
          </div>
        )}

        {mode === 'pick' && (
          <>
            {strategies.length > 0 ? (
              <div style={{display:'grid',gap:6,marginBottom:14,maxHeight:200,overflowY:'auto'}}>
                {strategies.map(s => (
                  <button key={s.id} onClick={()=>handle(s.id)} disabled={busy}
                    style={{padding:'8px 12px',border:'1px solid var(--bd)',borderRadius:6,background:trade.strategy_id===s.id?'rgba(102,255,165,.1)':'var(--sf2)',cursor:'pointer',textAlign:'left',transition:'all .15s'}}
                    onMouseEnter={e=>e.currentTarget.style.borderColor='#66ffa5'}
                    onMouseLeave={e=>e.currentTarget.style.borderColor='var(--bd)'}>
                    <div style={{fontWeight:600,fontSize:11,color:'var(--tx)'}}>{s.name}</div>
                    <div style={{fontSize:10,color:'var(--mu)',marginTop:2}}>
                      {s.type} · {s.trade_count} trades · {s.combined_pnl>=0?'+':''}{Math.round(s.combined_pnl).toLocaleString()} USD
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{fontSize:11,color:'var(--mu)',marginBottom:14}}>No strategies yet — create one below.</div>
            )}
            <button onClick={()=>setMode('new')} className="btn btn-p btn-sm">+ New strategy</button>
          </>
        )}

        {mode === 'new' && (
          <div style={{display:'grid',gap:10}}>
            <div>
              <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:5}}>NAME</div>
              <input className="inp" placeholder="e.g. LINK Delta Neutral Nov 2024"
                value={name} onChange={e=>setName(e.target.value)} autoFocus />
            </div>
            <div>
              <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:5}}>TYPE</div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {TYPES.map(t => (
                  <button key={t} onClick={()=>setType(t)}
                    style={{fontSize:10,padding:'3px 9px',borderRadius:4,border:`1px solid ${type===t?'#66ffa5':'var(--bd)'}`,background:type===t?'rgba(102,255,165,.1)':'var(--sf2)',color:type===t?'#66ffa5':'var(--mu)',cursor:'pointer'}}>
                    {t.replace('_',' ')}
                  </button>
                ))}
              </div>
            </div>
            <div style={{display:'flex',gap:8,marginTop:4}}>
              <button onClick={()=>setMode('pick')} className="btn btn-sm">Back</button>
              <button onClick={handleNew} disabled={!name.trim()||busy} className="btn btn-p btn-sm">
                {busy ? 'Saving…' : 'Create & tag'}
              </button>
            </div>
          </div>
        )}

        {mode === 'pick' && (
          <div style={{display:'flex',justifyContent:'flex-end',marginTop:14}}>
            <button className="btn" onClick={onClose}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── STRATEGY MANAGER MODAL ────────────────────────────────────────────────────
// Shows all strategies with combined PnL, trade count, ability to delete
function StrategyManagerModal({ strategies, onClose, onDeleted, onCreated }) {
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('delta_neutral')
  const [busy, setBusy]       = useState(false)
  const [confirm, setConfirm] = useState(null)

  const fU = n => (n>=0?'+':'') + '$' + Math.abs(Math.round(n)).toLocaleString()
  const TYPES = ['delta_neutral','carry','arb','basket','other']

  return (
    <div className="mo" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:'var(--sf)',border:'1px solid var(--bd)',borderRadius:10,padding:24,width:520,boxShadow:'var(--sh-lg)',margin:'auto',maxHeight:'80vh',display:'flex',flexDirection:'column'}}>
        <div style={{fontWeight:700,fontSize:13,marginBottom:16}}>Strategy Manager</div>

        {/* Strategy list */}
        <div style={{flex:1,overflowY:'auto',marginBottom:16}}>
          {strategies.length === 0 && (
            <div style={{fontSize:11,color:'var(--mu)',padding:'12px 0'}}>
              No strategies yet. Create one below, then tag trades by clicking the Strategy column.
            </div>
          )}
          {strategies.map(s => (
            <div key={s.id} style={{padding:'10px 12px',borderRadius:6,border:'1px solid var(--bd)',marginBottom:8,background:'var(--sf2)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                <div>
                  <div style={{fontWeight:600,fontSize:12,color:'var(--tx)',marginBottom:3}}>{s.name}</div>
                  <div style={{fontSize:10,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>
                    {s.type?.replace('_',' ')} · {s.trade_count||0} trades ·
                    <span style={{color:s.combined_pnl>=0?'#66ffa5':'#ff5258',marginLeft:4,fontWeight:700}}>
                      {fU(s.combined_pnl||0)}
                    </span>
                  </div>
                  {(s.first_entry||s.last_exit) && (
                    <div style={{fontSize:9,color:'var(--bd2)',marginTop:3,fontFamily:'var(--font-mono)'}}>
                      {s.first_entry?.slice(0,10)} → {s.last_exit?.slice(0,10)}
                      {s.symbols > 1 && ` · ${s.symbols} symbols`}
                      {s.brokers > 1 && ` · ${s.brokers} brokers`}
                    </div>
                  )}
                </div>
                <button onClick={()=>setConfirm(s.id)}
                  style={{fontSize:10,background:'none',border:'1px solid var(--bd)',borderRadius:4,color:'#ff5258',cursor:'pointer',padding:'2px 8px',flexShrink:0}}>
                  Delete
                </button>
              </div>
              {confirm === s.id && (
                <div style={{marginTop:8,display:'flex',gap:6,alignItems:'center'}}>
                  <span style={{fontSize:10,color:'var(--mu)'}}>Delete and untag all trades?</span>
                  <button onClick={async()=>{setBusy(true);try{await onDeleted(s.id);setConfirm(null)}catch(e){alert(e.message)}finally{setBusy(false)}}}
                    disabled={busy}
                    style={{fontSize:10,background:'rgba(255,82,88,.1)',border:'1px solid #ff5258',borderRadius:4,color:'#ff5258',cursor:'pointer',padding:'2px 8px'}}>
                    Confirm
                  </button>
                  <button onClick={()=>setConfirm(null)}
                    style={{fontSize:10,background:'none',border:'1px solid var(--bd)',borderRadius:4,color:'var(--mu)',cursor:'pointer',padding:'2px 8px'}}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Create new */}
        <div style={{borderTop:'1px solid var(--bd)',paddingTop:14}}>
          <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:8}}>NEW STRATEGY</div>
          <div style={{display:'flex',gap:8,marginBottom:8}}>
            <input className="inp" style={{flex:1}} placeholder="Strategy name…"
              value={newName} onChange={e=>setNewName(e.target.value)} />
            <select className="inp" style={{width:130}} value={newType} onChange={e=>setNewType(e.target.value)}>
              {TYPES.map(t => <option key={t} value={t}>{t.replace('_',' ')}</option>)}
            </select>
          </div>
          <div style={{display:'flex',justifyContent:'space-between'}}>
            <button onClick={async()=>{if(!newName.trim())return;setBusy(true);try{await onCreated(newName.trim(),newType);setNewName('')}catch(e){alert(e.message)}finally{setBusy(false)}}}
              disabled={!newName.trim()||busy} className="btn btn-p btn-sm">
              {busy?'Creating…':'Create'}
            </button>
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  )
}
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


// ── DASHBOARD ORDER LIST ──────────────────────────────────────────────────────
// Drag-to-reorder list for Overview sections in Settings
function SettingsPanel({ accounts=[],onEditAccount,onDeleteAccount,preview=false, settings, saveSetting, privacy, setPrivacy, darkMode, setDarkMode, acctStatsOpen, setAcctStatsOpen, onClose }) {
  const panelRef=useRef(null)
  useDialogFocus(panelRef,onClose)
  const DATE_PRESETS = ['YTD','1Y','6M','3M','1M','MTD','QTD','All']
  const TABS         = ['overview','edge','coach','streaks','calendar','symbols','timing','trades','review','missed']
  const TAB_LABELS   = { overview:'Overview', edge:'Edge', coach:'Coach', streaks:'Streaks', calendar:'Calendar', symbols:'Symbols', timing:'Timing', trades:'Trade Log',review:'Review queue', missed:'Passed' }
  const PAGE_SIZES   = [50, 100, 200]

  const Row = useCallback(({ label, sub, children }) => (
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 0',borderBottom:'1px solid var(--bd)'}}>
      <div>
        <div style={{fontSize:12,fontWeight:600,color:'var(--tx)'}}>{label}</div>
        {sub && <div style={{fontSize:10,color:'var(--mu)',marginTop:2}}>{sub}</div>}
      </div>
      <div style={{flexShrink:0,marginLeft:16}}>{children}</div>
    </div>
  ),[])

  const Toggle = useCallback(({ value, onChange, label }) => (
    <button role="switch" aria-label={label} aria-checked={!!value} onClick={()=>onChange(!value)}
      style={{width:42,height:24,borderRadius:12,border:'none',cursor:'pointer',transition:'all .2s',
        background:value?'var(--ac)':'var(--bd2)',position:'relative',flexShrink:0}}>
      <span style={{position:'absolute',top:3,left:value?20:3,width:18,height:18,borderRadius:'50%',background:'#fff',transition:'left .2s',display:'block'}} />
    </button>
  ),[])

  const Select = useCallback(({ value, options, onChange, label }) => (
    <select aria-label={label} value={value} onChange={e=>onChange(e.target.value)} className="inp"
      style={{padding:'4px 8px',fontSize:11,fontFamily:'var(--font-mono)',minWidth:90}}>
      {options.map(o => <option key={o.value||o} value={o.value||o}>{typeof o==='object'?(o.label||String(o.value)):o}</option>)}
    </select>
  ),[])

  return (
    <div className="mo" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} className="settings-panel" style={{background:'var(--sf)',border:'1px solid var(--bd)',borderRadius:12,width:420,maxHeight:'85vh',overflow:'auto',boxShadow:'var(--sh-lg)',margin:'auto',position:'relative'}}>
        <div style={{padding:'18px 24px',borderBottom:'1px solid var(--bd)',display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,background:'var(--sf)',zIndex:10}}>
          <div>
            <h2 id="settings-title" style={{fontWeight:600,fontSize:18,margin:0}}>Settings</h2>
            <div style={{fontSize:10,color:'var(--mu)',fontFamily:'var(--font-mono)',marginTop:2}}>Preferences saved to this browser</div>
          </div>
          <button aria-label="Close settings" data-dialog-close onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'var(--mu)',fontSize:18,padding:4}}>✕</button>
        </div>
        <div style={{padding:'0 24px 24px'}}>
          <BackupPanel settings={settings} /><ImportHistory /><details className="account-administration"><summary>Account administration</summary><p>Renaming keeps trades attached. Deletion requires typing the account ID and saves a safety backup.</p>{accounts.map(a=><div key={a.id}><span>{a.label||a.id}<small>{a.broker}</small></span><button className="btn btn-sm" disabled={preview} onClick={()=>onEditAccount(a)}>Rename</button><button className="btn btn-sm btn-d" disabled={preview} onClick={()=>onDeleteAccount(a.id)}>Delete account</button></div>)}<button className="btn btn-d" disabled={preview} onClick={()=>onDeleteAccount(null)}>Delete all accounts and trades…</button></details>
          <div style={{fontSize:9,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.08em',fontFamily:'var(--font-mono)',padding:'16px 0 4px'}}>APPEARANCE</div>
          <Row label="Dark mode" sub="Default theme on load">
            <Toggle label="Dark mode" value={settings.defaultDark} onChange={v=>{saveSetting('defaultDark',v); setDarkMode(v)}} />
          </Row>
          <Row label="Privacy mode" sub="Hide P&L values on load">
            <Toggle label="Hide amounts by default" value={settings.defaultPrivacy} onChange={v=>{saveSetting('defaultPrivacy',v); setPrivacy(v)}} />
          </Row>
          <div style={{fontSize:9,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.08em',fontFamily:'var(--font-mono)',padding:'16px 0 4px'}}>DASHBOARD</div>
          <Row label="Default date range" sub="Range selected on load">
            <Select label="Default date range" value={settings.defaultDatePreset} options={DATE_PRESETS} onChange={v=>saveSetting('defaultDatePreset',v)} />
          </Row>
          <Row label="Default tab" sub="Tab open on load">
            <Select label="Default tab" value={settings.defaultTab}
              options={TABS.map(t=>({value:t, label:TAB_LABELS[t]}))}
              onChange={v=>saveSetting('defaultTab',v)} />
          </Row>
          <Row label="Account breakdown" sub="Expanded or collapsed on load">
            <Toggle label="Expand account breakdown by default" value={settings.acctStatsDefault} onChange={v=>{saveSetting('acctStatsDefault',v); setAcctStatsOpen(v)}} />
          </Row>
          <div style={{fontSize:9,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.08em',fontFamily:'var(--font-mono)',padding:'16px 0 4px'}}>HYPERLIQUID</div>
          <Row label="CSV timezone" sub="Your local timezone when exporting from Hyperliquid">
            <Select value={settings.hlTimezone || 'Asia/Dubai'}
              options={[
                {value:'Asia/Dubai',       label:'Abu Dhabi / Dubai (UTC+4)'},
                {value:'Australia/Sydney', label:'Sydney (AEST/AEDT)'},
                {value:'UTC',              label:'UTC'},
                {value:'Europe/London',    label:'London (GMT/BST)'},
                {value:'America/New_York', label:'New York (ET)'},
                {value:'Asia/Singapore',   label:'Singapore (UTC+8)'},
                {value:'Asia/Tokyo',       label:'Tokyo (UTC+9)'},
                {value:'Europe/Paris',     label:'Paris / CET'},
              ]}
              onChange={v => saveSetting('hlTimezone', v)} />
          </Row>
          <div style={{fontSize:9,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.08em',fontFamily:'var(--font-mono)',padding:'16px 0 4px'}}>TRADE LOG</div>
          <Row label="Rows per page" sub="Number of trades shown per page">
            <Select label="Rows per page" value={settings.tradeLogPageSize} options={PAGE_SIZES.map(n=>({value:n,label:n+' rows'}))} onChange={v=>saveSetting('tradeLogPageSize',parseInt(v))} />
          </Row>
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
  const [tempId,       setTempId]    = useState(null)
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
  const [entryAI,      setEntryAI]    = useState({})

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
      if (activeTo)   params.set('to',   activeTo   + 'T23:59:59.999Z')
      const res  = await journalFetch('/api/missed-trades?' + params)
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
      const res  = await journalFetch('/api/missed-trades', { method: editingId ? 'PATCH' : 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
      const data = await res.json()
      if (!data.missed_trade) throw new Error('The saved passed trade could not be confirmed. Please retry.')
      if (data.missed_trade) {
        const saved = data.missed_trade
        if (editingId) {
          setMissed(prev => prev.map(m => m.id === editingId ? saved : m))
        } else {
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
      await journalFetch('/api/missed-trades?id=' + id, { method:'DELETE' })
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
    const pct = form.direction === 'Long' ? (xp/ep - 1) : ((ep-xp)/ep)
    return { pct: pct*100, usd: pct*sz }
  })()

  const generateAI = async () => {
    if (!missed.length) return
    setAiLoading(true); setAiError(null)
    try {
      const res  = await journalFetch('/api/ai-coach', {
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
      const res  = await journalFetch('/api/ai-coach', {
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
      const res  = await journalFetch('/api/ai-coach', {
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
      const res = await journalFetch('/api/coach-reports', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ period:periodLabel, date_from:dateFrom, date_to:dateTo, trade_count:tradeCount, score:report.score, archetype:report.archetype, core_edge:report.core_edge, core_weakness:report.core_weakness, coaching_tip:report.coaching_tip, insights:report.insights, provider:report.provider }) })
      if (res.ok) { setSavedOk(true); setTimeout(()=>setSavedOk(false), 3000) }
      else setError('Failed to save report.')
    } catch(e) { setError('Failed to save report.') }
    setSaving(false)
  }

  const loadHistory = async () => {
    setHistLoad(true)
    try { const res=await journalFetch('/api/coach-reports'); const data=await res.json(); setHistory(data.reports||[]) } catch(e) { console.error(e) }
    setHistLoad(false)
  }
  const toggleHistory = () => { if (!showHist) loadHistory(); setShowHist(h=>!h) }
  const deleteReport  = async (id) => { if (!confirm('Delete this saved report?')) return; try { await journalFetch(`/api/coach-reports?id=${id}`,{method:'DELETE'}); setHistory(h=>h.filter(r=>r.id!==id)) } catch(e) { setError(e.message) } }
  const loadSavedReport = (saved) => { setReport({...saved, insights:typeof saved.insights==='string'?JSON.parse(saved.insights):saved.insights}); setGenerated(true); setShowHist(false); setLastRun(null) }

  const exportPDF = () => {
    if (!report) return
    const printWin = window.open('', '_blank')
    if(!printWin)return
    printWin.opener=null
    const insights = (typeof report.insights==='string'?JSON.parse(report.insights):report.insights)||[]
    const TYPE_COLOR = { critical:'#dc2626', bias:'#d97706', opportunity:'#1a56db', strength:'#059669' }
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>AI Coaching Report</title>
<style>body{font-family:Arial,sans-serif;font-size:13px;color:#0f1117;max-width:900px;margin:0 auto;padding:32px}h1{font-size:22px;margin-bottom:4px}.sub{color:#6b7280;font-size:12px;margin-bottom:24px}.meta{display:flex;gap:24px;margin-bottom:24px;padding:16px;background:#f7f8fa;border-radius:8px;border:1px solid #e2e5ea}.meta-label{font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em}.meta-val{font-size:18px;font-weight:700;color:#1a56db}.edge-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px}.edge-box{padding:12px 16px;border-radius:8px}.edge-win{background:#ecfdf5;border:1px solid #a7f3d0}.edge-los{background:#fef2f2;border:1px solid #fecaca}.edge-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}.tip{padding:12px 16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;margin-bottom:24px}.tip-lbl{font-size:10px;font-weight:700;color:#1e429f;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}.insights{display:grid;grid-template-columns:1fr 1fr;gap:12px}.insight{border-radius:8px;padding:14px;border:1px solid #e2e5ea;page-break-inside:avoid}.ins-tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;margin-bottom:8px;color:#fff}.ins-title{font-weight:700;font-size:13px;margin-bottom:6px}.ins-body{font-size:12px;color:#3a3f4a;line-height:1.6;margin-bottom:10px}.ins-action{font-size:11px;padding:8px 10px;background:#f7f8fa;border-radius:4px;line-height:1.6}.footer{margin-top:32px;padding-top:16px;border-top:1px solid #e2e5ea;font-size:11px;color:#9ca3af}@media print{body{padding:16px}}</style></head><body>
<h1>AI Trading Coach Report</h1>
<div class="sub">Period: ${escapeHTML(report.period||periodLabel)} · ${tradeCount?.toLocaleString()} trades · via ${report.provider==='claude'?'Claude (Anthropic)':'Qwen-Plus'}</div>
<div class="meta"><div class="meta-item"><div class="meta-label">Consistency Score</div><div class="meta-val">${escapeHTML(report.score??'—')}/100</div></div>${report.archetype?`<div class="meta-item"><div class="meta-label">Trader Archetype</div><div class="meta-val" style="font-size:14px">${escapeHTML(report.archetype)}</div></div>`:''}</div>
${report.core_edge?`<div class="edge-grid"><div class="edge-box edge-win"><div class="edge-lbl" style="color:#065f46">✅ Core Edge</div><div style="color:#065f46">${escapeHTML(report.core_edge)}</div></div><div class="edge-box edge-los"><div class="edge-lbl" style="color:#991b1b">⚠ Core Weakness</div><div style="color:#991b1b">${escapeHTML(report.core_weakness)}</div></div></div>`:''}
${report.coaching_tip?`<div class="tip"><div class="tip-lbl">💡 This Week's Focus</div><div style="color:#1e429f">${escapeHTML(report.coaching_tip)}</div></div>`:''}
<div class="insights">${insights.map(ins=>{const c=TYPE_COLOR[ins.type]||'#6b7280';return`<div class="insight" style="border-left:3px solid ${c}"><span class="ins-tag" style="background:${c}">${escapeHTML(ins.tag||ins.type?.toUpperCase())}</span><div class="ins-title">${escapeHTML(ins.title)}</div><div class="ins-body">${escapeHTML(ins.body)}</div><div class="ins-action"><strong>Action:</strong> ${escapeHTML(ins.action)}</div></div>`}).join('')}</div>
<div class="footer">Trading Journal · AI Coaching Report · ${escapeHTML(report.period||periodLabel)}</div>
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
    <div className="anim coach-workspace"><div className="page-heading"><div><span className="eyebrow">Review</span><h1>Trading coach</h1><p>Reflect on a period, then choose one thing to improve.</p></div></div>
      <div className="card" style={{marginBottom:14}}>
        <CoachReportHeader report={report}>
            <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.08em',fontFamily:'var(--font-mono)',marginBottom:4}}>Period review</div>
            <div style={{fontSize:15,fontWeight:700,marginBottom:2}}>Performance Analysis · {tradeCount?.toLocaleString()||0} Trades</div>
            <div style={{fontSize:11,color:'var(--ac)',fontFamily:'var(--font-mono)',fontWeight:600,marginBottom:8}}>Period: {periodLabel}</div>
            <div style={{fontSize:12,color:'var(--mu)',lineHeight:1.6,maxWidth:520,marginBottom:12}}>Change the date range at the top of the page first, then generate a report for that specific period.</div>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
              <button className={`btn ${loading?'':'btn-p'}`} onClick={generate} disabled={loading||!stats} style={{padding:'8px 20px',fontSize:13,gap:8}}>
                {loading?(<><span style={{width:14,height:14,border:'2px solid var(--bd2)',borderTop:'2px solid var(--ac)',borderRadius:'50%',display:'inline-block',animation:'spin 1s linear infinite'}} /> Analysing {tradeCount?.toLocaleString()} trades…</>):generated?'Regenerate report':'Generate coaching report'}
              </button>
              {report && (<>
                <button className="btn" onClick={saveReport} disabled={saving} style={{gap:6}}>{saving?'Saving…':savedOk?'Saved':'Save report'}</button>
                <button className="btn" onClick={exportPDF} style={{gap:6}}>Export PDF</button>
              </>)}
              <button className="btn" onClick={toggleHistory} style={{gap:6,marginLeft:'auto'}}>{showHist?'Hide':'View'} saved reports</button>
            </div>
            {lastRun&&!loading&&<div style={{fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)',marginTop:8}}>Generated: {lastRun} · via {providerLabel} · period: {periodLabel}</div>}
            {!stats&&<div style={{fontSize:11,color:'var(--mu)',marginTop:8}}>Upload trades first to enable AI analysis.</div>}

        </CoachReportHeader>
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

          <div style={{fontWeight:600,fontSize:14,marginBottom:6,color:'var(--tx)'}}>Ready to analyse your trading</div>
          <div style={{fontSize:12,maxWidth:420,margin:'0 auto',lineHeight:1.7}}>Choose a reporting period above, then generate a report. Each report is saved separately so you can compare periods over time.</div>
        </div>
      )}
    </div>
  )
}
