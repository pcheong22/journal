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
const fU = n => {
  if (n === undefined || n === null) return '$0'
  const formatted = n.toLocaleString('en-US', { 
    style: 'currency', 
    currency: 'USD', 
    minimumFractionDigits: 0,
    maximumFractionDigits: 0 
  })
  return formatted
}

export default function Dashboard() {
  // State
  const [user, setUser] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [trades, setTrades] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  
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
        
        // Default selection: All accounts initially
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
    
    try {
      const reader = new FileReader()
      const fileAsBase64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(uploadFile)
      })

      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileContent: fileAsBase64,
          fileName: uploadFile.name,
          accountId: accountId
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      
      alert(`✅ Imported ${data.count} trades. Skipped: ${data.skipped}`)
      await loadTrades()
    } catch (err) {
      console.error(err)
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
          {/* NAVIGATION TABS */}
          <nav style={{display:'flex',gap:24,marginLeft:40}}>
            {['Overview','Trades','Analytics','AI Coach','Missed Trades'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab.toLowerCase().replace(' ','-'))}
                style={{
                  background:'none',
                  border:'none',
                  color: activeTab === tab.toLowerCase().replace(' ','-') ? '#4bde80' : '#8b949e',
                  borderBottom: activeTab === tab.toLowerCase().replace(' ','-') ? '2px solid #4bde80' : '2px solid transparent',
                  padding:'8px 0',
                  cursor:'pointer',
                  fontSize:13,
                  fontWeight:500
                }}
              >
                {tab}
              </button>
            ))}
          </nav>
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
        
        {activeTab === 'overview' && (
          <>
            {/* DATE FILTER */}
            <DateRangeFilter onRangeChange={setDateRange} defaultValue="MTD" />

            {/* KPI CARDS */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:16,marginBottom:24}}>
              <div className="kpi-card" onClick={() => setHidePnl(!hidePnl)} style={{cursor:'pointer',background:'#161b22',border:'1px solid #30363d',borderRadius:8,padding:16}}>
                <div className="kpi-label" style={{fontSize:11,color:'#8b949e',textTransform:'uppercase',marginBottom:4}}>
                  NET P&L {hidePnl ? '👁️‍🗨️' : '👁️'}
                </div>
                <div className="kpi-value" style={{fontSize:24,fontWeight:700,color: (stats?.overview?.total_pnl || 0) >= 0 ? '#4bde80' : '#b94144',filter: hidePnl ? 'blur(4px)' : 'none'}}>
                  {hidePnl ? '*********' : fU(stats?.overview?.total_pnl || 0)}
                </div>
                <div style={{fontSize:11,color:'#8b949e',marginTop:4}}>
                  {((stats?.overview?.total_pnl || 0) / 1000 * 100).toFixed(1)}% ROI
                </div>
              </div>

              <div className="kpi-card" style={{background:'#161b22',border:'1px solid #30363d',borderRadius:8,padding:16}}>
                <div className="kpi-label" style={{fontSize:11,color:'#8b949e',textTransform:'uppercase',marginBottom:4}}>WIN RATE</div>
                <div className="kpi-value" style={{fontSize:24,fontWeight:700,color:'#4bde80'}}>
                  {stats?.overview?.win_rate ? (stats.overview.win_rate * 100).toFixed(1) : 0}%
                </div>
                <div style={{fontSize:11,color:'#8b949e',marginTop:4}}>
                  {filteredTrades.filter(t => t.pnl > 0).length} Wins / {filteredTrades.filter(t => t.pnl < 0).length} Losses
                </div>
              </div>

              <div className="kpi-card" style={{background:'#161b22',border:'1px solid #30363d',borderRadius:8,padding:16}}>
                <div className="kpi-label" style={{fontSize:11,color:'#8b949e',textTransform:'uppercase',marginBottom:4}}>TRADES</div>
                <div className="kpi-value" style={{fontSize:24,fontWeight:700,color:'#e6edf3'}}>
                  +{filteredTrades.length}
                </div>
              </div>

              <div className="kpi-card" style={{background:'#161b22',border:'1px solid #30363d',borderRadius:8,padding:16}}>
                <div className="kpi-label" style={{fontSize:11,color:'#8b949e',textTransform:'uppercase',marginBottom:4}}>AVG R:R</div>
                <div className="kpi-value" style={{fontSize:24,fontWeight:700,color:'#ffb300'}}>
                  0.62
                </div>
                <div style={{fontSize:11,color:'#8b949e',marginTop:4}}>Target {'>'} 1.5</div>
              </div>
            </div>

            {/* CHARTS */}
            <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:16,marginBottom:24}}>
              <ChartComp type="equity" data={stats?.cumulative || []} privacyMode={hidePnl} />
              <ChartComp type="monthly" data={stats?.monthly || []} />
            </div>
            
            {/* TRADE TABLE PREVIEW */}
            <div style={{marginTop:24}}>
              <h3 style={{fontSize:14,fontWeight:600,marginBottom:12,color:'#e6edf3'}}>Recent Trades</h3>
              <div style={{fontSize:11,color:'#8b949e',marginBottom:12}}>Showing {filteredTrades.length} trades</div>
              <table className="data-table" style={{width:'100%',borderCollapse:'collapse'}}>
                <thead>
                  <tr style={{borderBottom:'1px solid #30363d'}}>
                    <th style={{textAlign:'left',padding:'8px 12px',fontSize:10,color:'#8b949e',textTransform:'uppercase'}}>Symbol</th>
                    <th style={{textAlign:'left',padding:'8px 12px',fontSize:10,color:'#8b949e',textTransform:'uppercase'}}>Direction</th>
                    <th style={{textAlign:'left',padding:'8px 12px',fontSize:10,color:'#8b949e',textTransform:'uppercase'}}>Entry</th>
                    <th style={{textAlign:'left',padding:'8px 12px',fontSize:10,color:'#8b949e',textTransform:'uppercase'}}>P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTrades.slice(0,5).map(t => (
                    <tr key={t.position_id} onClick={() => setTradeModal(t)} style={{cursor:'pointer',borderBottom:'1px solid #21262d'}}>
                      <td style={{padding:'10px 12px',fontSize:12,color:'#e6edf3'}}>{t.symbol}</td>
                      <td style={{padding:'10px 12px',fontSize:12}}>
                        <span className={`pill ${t.direction==='Long'?'pill-bull':'pill-bear'}`} style={{
                          padding:'2px 8px',
                          borderRadius:4,
                          fontSize:10,
                          fontWeight:600,
                          background: t.direction==='Long' ? 'rgba(75,222,128,0.15)' : 'rgba(185,65,68,0.15)',
                          color: t.direction==='Long' ? '#4bde80' : '#b94144'
                        }}>
                          {t.direction}
                        </span>
                      </td>
                      <td style={{padding:'10px 12px',fontSize:12,color:'#8b949e'}}>{t.entry_price?.toLocaleString()}</td>
                      <td style={{padding:'10px 12px',fontSize:12,color: t.pnl >= 0 ? '#4bde80' : '#b94144'}}>{fU(t.pnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {activeTab === 'trades' && (
          <div style={{padding:20}}>
            <h2 style={{fontSize:18,fontWeight:700,marginBottom:16,color:'#e6edf3'}}>All Trades</h2>
            <div style={{color:'#8b949e'}}>Full trade list coming soon...</div>
          </div>
        )}

        {activeTab === 'analytics' && (
          <div style={{padding:20}}>
            <h2 style={{fontSize:18,fontWeight:700,marginBottom:16,color:'#e6edf3'}}>Analytics</h2>
            <div style={{color:'#8b949e'}}>Advanced analytics coming soon...</div>
          </div>
        )}

        {activeTab === 'ai-coach' && (
          <div style={{padding:20}}>
            <h2 style={{fontSize:18,fontWeight:700,marginBottom:16,color:'#e6edf3'}}>AI Coach</h2>
            <div style={{color:'#8b949e'}}>AI insights coming soon...</div>
          </div>
        )}

        {activeTab === 'missed-trades' && (
          <div style={{padding:20}}>
            <h2 style={{fontSize:18,fontWeight:700,marginBottom:16,color:'#e6edf3'}}>Missed Trades</h2>
            <div style={{color:'#8b949e'}}>Missed trades tracker coming soon...</div>
          </div>
        )}

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