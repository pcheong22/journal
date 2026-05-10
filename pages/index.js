import { useState, useEffect } from 'react'
import Head from 'next/head'
import { supabase } from '../lib/supabase'
import { signOut } from '../lib/auth'
import { parseTradeFile, computeStats } from '../lib/tradeUtils'
import DateRangeFilter from '../components/DateRangeFilter'
import UploadModal from '../components/UploadModal'
import ChartComp from '../components/Charts'
import TradeModal from '../components/TradeModal'

// ── FORMATTING HELPERS ───────────────────────────────────────────────────────
const fU = n => (n >= 0 ? '+' : '') + n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export default function Dashboard() {
  // State
  const [user, setUser] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [trades, setTrades] = useState([])
  const [loading, setLoading] = useState(true)
  
  // Filters & Preferences
  const [hidePnl, setHidePnl] = useState(true)
  const [selectedAccounts, setSelectedAccounts] = useState(new Set())
  const [dateRange, setDateRange] = useState({ start: new Date(0), end: new Date(), label: 'All' })
  
  // Modals
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [uploadFile, setUploadFile] = useState(null)
  const [tradeModal, setTradeModal] = useState(null)

  // ── INITIALIZATION ─────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      try {
        // 1. Get User
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { window.location.href = '/login'; return }
        setUser(user)

        // 2. Fetch Accounts
        const { data: accs } = await supabase.from('accounts').select('*').order('created_at')
        setAccounts(accs || [])
        
        // Default selection: All accounts initially, or specific ones if you prefer
        if (accs?.length) setSelectedAccounts(new Set(accs.map(a => a.id)))

        // 3. Fetch Trades
        await loadTrades()
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  const loadTrades = async () => {
    const { data } = await supabase.from('trades').select('*').order('entry_time', { ascending: true })
    setTrades(data || [])
  }

  // ── FILTERING LOGIC ────────────────────────────────────────────────────────
  const filteredTrades = trades.filter(t => {
    const tDate = new Date(t.entry_time)
    const inTime = tDate >= dateRange.start && tDate <= dateRange.end
    const inAcc = selectedAccounts.has(t.account_id)
    return inTime && inAcc
  })

  const stats = computeStats(filteredTrades)

  // ── HANDLERS ───────────────────────────────────────────────────────────────
  const toggleAccount = id => {
    const newSet = new Set(selectedAccounts)
    if (newSet.has(id)) newSet.delete(id)
    else newSet.add(id)
    setSelectedAccounts(newSet)
  }

  const handleDrop = e => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) { setUploadFile(file); setUploadModalOpen(true) }
  }

  const handleUploadSubmit = async (accountId) => {
    if (!uploadFile || !accountId) return
    setUploadModalOpen(false)
    
    // Show temporary loading state or toast here if desired
    const formData = new FormData()
    formData.append('file', uploadFile)
    formData.append('accountId', accountId)

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      
      alert(`✅ Imported ${data.count} trades. Skipped: ${data.skipped}`)
      await loadTrades() // Refresh data
    } catch (err) {
      alert('❌ Upload failed: ' + err.message)
    } finally {
      setUploadFile(null)
    }
  }

  if (loading) return <div style={{background:'#0c1117',height:'100vh'}} />

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Head><title>Trading Journal</title></Head>
      
      {/* HEADER */}
      <header style={{background:'#161b22',borderBottom:'1px solid #30363d',padding:'0 24px',height:52,display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,zIndex:100}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{width:28,height:28,background:'#4bde80',borderRadius:6,display:'grid',placeItems:'center',color:'#0c1117',fontWeight:700}}>↗</div>
          <div>
            <div style={{fontWeight:700,fontSize:13,letterSpacing:0.05,textTransform:'uppercase'}}>Journal</div>
            <div style={{fontSize:9,color:'#8b949e',letterSpacing:0.1,textTransform:'uppercase'}}>Performance Intelligence</div>
          </div>
        </div>
        <button onClick={signOut} className="btn" style={{fontSize:11,padding:'4px 12px'}}>Sign Out</button>
      </header>

      {/* ACCOUNT SELECTOR BAR */}
      <div style={{background:'#161b22',borderBottom:'1px solid #30363d',padding:'8px 24px',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        <span style={{fontSize:10,fontWeight:600,color:'#8b949e',textTransform:'uppercase',marginRight:4}}>ACCOUNTS</span>
        <button onClick={() => setSelectedAccounts(new Set(accounts.map(a=>a.id)))} className="btn btn-primary" style={{padding:'4px 10px',fontSize:11}}>ALL ({accounts.length})</button>
        
        {accounts.map(acc => (
          <div key={acc.id} onClick={() => toggleAccount(acc.id)} style={{
            display:'flex',alignItems:'center',gap:6,padding:'4px 10px',borderRadius:6,cursor:'pointer',
            background: selectedAccounts.has(acc.id) ? 'rgba(75,222,128,0.1)' : '#0c1117',
            border: `1px solid ${selectedAccounts.has(acc.id) ? '#4bde80' : '#30363d'}`,
            fontSize:11,color: selectedAccounts.has(acc.id) ? '#4bde80' : '#8b949e'
          }}>
            <span style={{width:6,height:6,borderRadius:'50%',background:acc.color||'#4bde80'}}/>
            {acc.label || acc.id}
          </div>
        ))}
      </div>

      {/* UPLOAD BAR */}
      <div onDragOver={e=>e.preventDefault()} onDrop={handleDrop} style={{background:'#12171e',borderBottom:'1px solid #30363d',padding:'12px 24px',display:'flex',alignItems:'center',gap:12}}>
        <div style={{flex:1,border:'1.5px dashed #383f47',borderRadius:8,padding:10,textAlign:'center',cursor:'pointer',color:'#8b949e',fontSize:12}} onClick={() => document.getElementById('file-input').click()}>
          📂 Drop CSV here or click to upload · Auto-detects Broker
        </div>
        <input id="file-input" type="file" accept=".csv,.xlsx" style={{display:'none'}} onChange={e => { if(e.target.files[0]) { setUploadFile(e.target.files[0]); setUploadModalOpen(true) } }} />
      </div>

      {/* MAIN CONTENT */}
      <main style={{padding:'20px 24px',maxWidth:1440,margin:'0 auto'}}>
        
        {/* DATE FILTER */}
        <DateRangeFilter onRangeChange={setDateRange} defaultValue="MTD" />

        {/* KPI CARDS */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12,marginBottom:20}}>
          {[
            ['NET P&L', stats?.overview?.total_pnl || 0, hidePnl],
            ['WIN RATE', stats?.overview?.win_rate * 100, false],
            ['TRADES', stats?.overview?.total_trades || 0, false],
            ['AVG R:R', 0.62, false] // Placeholder until implemented
          ].map(([label, val, isPnl]) => (
            <div key={label} className="kpi-card" onClick={isPnl ? () => setHidePnl(!hidePnl) : undefined} style={{cursor: isPnl ? 'pointer' : 'default'}}>
              <div className="kpi-label">
                {label}
                {isPnl && <span className="privacy-eye">{hidePnl ? '👁️‍🗨️' : '👁️'}</span>}
              </div>
              <div className={`kpi-value ${val >= 0 ? 'c-pos' : 'c-neg'}`} style={{filter: isPnl && hidePnl ? 'blur(4px)' : 'none'}}>
                {isPnl && hidePnl ? '*********' : (typeof val === 'number' && val % 1 !== 0 ? val.toFixed(2) : (typeof val === 'number' ? fU(val).replace('$','') + (label.includes('RATE') ? '%' : '') : val))}
              </div>
            </div>
          ))}
        </div>

        {/* CHARTS */}
        <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:16}}>
          <ChartComp type="equity" data={stats?.cumulative || []} privacyMode={hidePnl} />
          <ChartComp type="monthly" data={stats?.monthly || []} />
        </div>
        
        {/* TRADE TABLE PREVIEW */}
        <div style={{marginTop:24}}>
           <h3 style={{fontSize:14,fontWeight:600,marginBottom:12}}>Recent Trades</h3>
           <table className="data-table">
             <thead><tr><th>Symbol</th><th>Direction</th><th>Entry</th><th>P&L</th></tr></thead>
             <tbody>
               {filteredTrades.slice(0,5).map(t => (
                 <tr key={t.position_id} onClick={() => setTradeModal(t)} style={{cursor:'pointer'}}>
                   <td>{t.symbol}</td>
                   <td><span className={`pill ${t.direction==='Long'?'pill-bull':'pill-bear'}`}>{t.direction}</span></td>
                   <td>{t.entry_price}</td>
                   <td className={t.pnl >=0 ? 'c-pos' : 'c-neg'}>{fU(t.pnl)}</td>
                 </tr>
               ))}
             </tbody>
           </table>
        </div>

      </main>

      {/* MODALS */}
      {uploadModalOpen && (
        <UploadModal 
          file={uploadFile} 
          accounts={accounts} 
          onClose={() => setUploadModalOpen(false)} 
          onUpload={handleUploadSubmit} 
        />
      )}
      
      {tradeModal && (
        <TradeModal 
          trade={tradeModal} 
          trades={filteredTrades} 
          onClose={() => setTradeModal(null)} 
          onNavigate={t => setTradeModal(t)} 
        />
      )}
    </>
  )
}