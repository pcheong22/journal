import { useState, useEffect, useCallback } from 'react'
import { simulatePnLPath } from '../lib/tradeUtils'
import { PnlPathChart } from './Charts'
import ImageGallery from './ImageGallery'

const fU   = (n,d=0) => (n>=0?'+':'')+n.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:d,maximumFractionDigits:d})
const fPct = (n,d=3) => (n>=0?'+':'')+n.toFixed(d)+'%'
const SESSION_CLASS = { Asia:'pill-asia', London:'p-lon', 'London/NY Overlap':'p-ov', 'New York':'p-ny' }

const CAT_COLORS = {
  Psychology: '#ea580c', Setup: '#1a56db', Risk: '#dc2626',
  Journal: '#059669', Market: '#7c3aed', Custom: '#6b7280',
}

export default function TradeModal({ trade, onClose, trades, onNavigate, tags = [], onSaved }) {
  const [tf,          setTf]          = useState('1')
  const [sim,         setSim]         = useState(null)
  const [activeSection, setSection]   = useState('chart') // chart | notes | tags | ai

  // Notes state — pre-populate from trade if already saved
  const [noteEntry,   setNoteEntry]   = useState('')
  const [noteMgmt,    setNoteMgmt]    = useState('')
  const [noteLessons, setNoteLessons] = useState('')
  const [noteEmotion, setNoteEmotion] = useState('')
  const [noteFree,    setNoteFree]    = useState('')
  const [stopLoss,    setStopLoss]    = useState('')
  const [saving,      setSaving]      = useState(false)
  const [showNotionalTip, setShowNotionalTip] = useState(false)
  const [saved,       setSaved]       = useState(false)

  // Tags state
  const [selectedTags, setSelectedTags] = useState(new Set())
  const [tagCat,        setTagCat]      = useState('all')
  const [tagSearch,     setTagSearch]   = useState('')

  // AI coach state
  const [aiLoading,   setAiLoading]   = useState(false)
  const [aiResult,    setAiResult]    = useState(null)
  const [aiError,     setAiError]     = useState(null)

  const idx = trades.indexOf(trade)

  // Load saved values when trade changes
  useEffect(() => {
    if (!trade) return
    setSim(simulatePnLPath(trade))
    setNoteEntry(trade.note_entry_reason    || '')
    setNoteMgmt(trade.note_management       || '')
    setNoteLessons(trade.note_lessons       || '')
    setNoteEmotion(trade.note_emotional_state || '')
    setNoteFree(trade.notes                 || '')
    setStopLoss(trade.stop_loss != null ? String(trade.stop_loss) : '')
    setSelectedTags(new Set())
    setAiResult(null); setAiError(null); setSaved(false)
    setSection('chart')
  }, [trade])

  // Keyboard nav
  const handleKey = useCallback(e => {
    if (e.key === 'Escape')       onClose()
    if (e.key === 'ArrowLeft'  && idx > 0)                 onNavigate(trades[idx-1])
    if (e.key === 'ArrowRight' && idx < trades.length - 1) onNavigate(trades[idx+1])
  }, [idx, trades, onClose, onNavigate])

  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [handleKey])

  if (!trade) return null

  const pnlPos = trade.pnl >= 0
  const pnlC   = pnlPos ? 'var(--wn)' : 'var(--ls)'
  const tvSym  = trade.tv_symbol || trade.symbol
  const tvUrl  = `https://www.tradingview.com/widgetembed/?frameElementId=tv&symbol=${encodeURIComponent(tvSym)}&interval=${tf}&theme=light&style=1&timezone=UTC&withdateranges=1&allow_symbol_change=1&toolbarbg=f8f9fa&hidesidetoolbar=0`
  const tvFull = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSym)}&interval=${tf}`

  const priceMove = trade.exit_price && trade.entry_price ? trade.exit_price - trade.entry_price : null
  const pts       = priceMove != null ? (trade.direction==='Long' ? priceMove : -priceMove) : null
  const pctVal = (trade.entry_price && trade.exit_price && trade.entry_price > 0)
    ? (trade.direction === 'Long'
        ? (trade.exit_price / trade.entry_price - 1) * 100
        : (trade.entry_price / trade.exit_price - 1) * 100)
    : trade.pct_gain
  const pct = pctVal != null ? fPct(pctVal) : '—'
  const dur       = trade.duration_mins ? (trade.duration_mins/60).toFixed(1)+'h' : '—'
  const not = trade.notional_usd ? '$'+Math.round(trade.notional_usd).toLocaleString() : '—'

  // Build notional audit tooltip
  const notionalTooltip = (() => {
    if (!trade.notional_usd || !trade.entry_price || !trade.exit_price) return null
    const move = trade.direction === 'Long'
      ? (trade.exit_price / trade.entry_price - 1) * 100
      : (trade.entry_price / trade.exit_price - 1) * 100
    if (trade.notional_method === 'backsolve') {
      return `Back-solved from price move\nEntry ${trade.entry_price?.toLocaleString()} → Exit ${trade.exit_price?.toLocaleString()}\nMove: ${move>=0?'+':''}${move.toFixed(3)}% · $${Math.abs(Math.round(trade.pnl)).toLocaleString()} ÷ ${Math.abs(move).toFixed(3)}% = ${not}`
    } else if (trade.notional_method === 'price_x_size') {
      return `Calculated as price × size\nExit ${trade.exit_price?.toLocaleString()} × ${trade.size?.toLocaleString()} contracts = ${not}`
    }
    return null
  })()

  const capture  = sim && sim.mfe > 0 ? Math.max(0, Math.min(100, trade.pnl/sim.mfe*100)) : null
  const entryQ   = sim && sim.mfe > 0 ? Math.max(0, Math.min(100, 100*(1-Math.abs(sim.mae)/Math.max(Math.abs(sim.mae)+sim.mfe, .01)))) : 50
  const exitQ    = capture ?? 50
  const qC       = v => v>=70?'var(--wn)':v>=40?'var(--wa)':'var(--ls)'

  // Computed R-Multiple from live stop loss input
  const computedR = (() => {
    const sl = parseFloat(stopLoss)
    if (!sl || !trade.entry_price || !trade.exit_price) return null
    const risk   = trade.direction==='Long' ? trade.entry_price - sl : sl - trade.entry_price
    const reward = trade.direction==='Long' ? trade.exit_price - trade.entry_price : trade.entry_price - trade.exit_price
    if (risk <= 0) return null
    return (reward / risk).toFixed(2)
  })()

  const rDisplay = trade.r_multiple != null ? trade.r_multiple : computedR

  // Save notes + tags
  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch('/api/trade-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeId:             trade.id,
          notes:               noteFree,
          note_entry_reason:   noteEntry,
          note_management:     noteMgmt,
          note_lessons:        noteLessons,
          note_emotional_state: noteEmotion,
          stop_loss:           stopLoss ? parseFloat(stopLoss) : null,
          tagIds:              [...selectedTags],
        })
      })
      setSaved(true)
      if (onSaved) await onSaved()
      setTimeout(() => setSaved(false), 2000)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  // AI analysis
  const handleAI = async () => {
    setAiLoading(true); setAiError(null); setAiResult(null)
    try {
      const res  = await fetch('/api/ai-coach', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          trade: { ...trade, r_multiple: rDisplay, stop_loss: stopLoss || trade.stop_loss },
          notes: { note_entry_reason: noteEntry, note_management: noteMgmt, note_lessons: noteLessons, note_emotional_state: noteEmotion, notes: noteFree },
          stats: null,
          rules: [],
        }),
      })
      const data = await res.json()
      if (data.stub) setAiError(data.message || data.coaching_tip)
      else           setAiResult(data)
    } catch(e) { setAiError('AI analysis failed — check your connection') }
    setAiLoading(false)
  }

  // Filtered tags
  const filteredTags = tags.filter(t => {
    if (tagCat !== 'all' && t.category.toLowerCase() !== tagCat) return false
    if (tagSearch && !t.name.toLowerCase().includes(tagSearch.toLowerCase())) return false
    return true
  })
  const tagCategories = ['all', ...new Set(tags.map(t => t.category.toLowerCase()))]

  // Section nav
  const SECTIONS = [
    { id:'chart',  label:'📈 Chart' },
    { id:'pnl',    label:'📊 P&L Path' },
    { id:'notes',  label:'📝 Notes' },
    { id:'images', label:'🖼️ Images' },
    { id:'tags',   label:'🏷 Tags' },
    { id:'ai',     label:'🧠 AI Coach' },
  ]

  return (
    <div className="mo" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="mb">

        {/* ── MODAL HEADER ─────────────────────────────────────────────── */}
        <div className="mh">
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
            <div>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                <span className={`pill ${trade.direction==='Long'?'pb':'pr'}`} style={{fontSize:11,padding:'3px 8px'}}>
                  {trade.direction==='Long'?'▲':'▼'} {trade.direction}
                </span>
                <span style={{fontWeight:700,fontSize:16}}>{trade.symbol}</span>
                <span style={{color:'var(--bd2)'}}>·</span>
                <span className="private" style={{fontFamily:'var(--font-mono)',fontSize:15,fontWeight:700,color:pnlC}}>{fU(trade.pnl)}</span>
                <span className={`pill ${pnlPos?'pb':'pr'}`}>{pnlPos?'WIN':'LOSS'}</span>
                {rDisplay && <span style={{fontFamily:'var(--font-mono)',fontSize:11,color:parseFloat(rDisplay)>=1?'var(--wn)':'var(--ls)',fontWeight:600,background:'var(--sf3)',padding:'2px 7px',borderRadius:4}}>{rDisplay}R</span>}
              </div>
              <div style={{fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>
                {trade.entry_time?.slice(0,16).replace('T',' ')} → {trade.exit_time?.slice(0,16).replace('T',' ')} GMT
                &nbsp;·&nbsp;{trade.session}&nbsp;·&nbsp;{trade.day_of_week}&nbsp;·&nbsp;{dur}
              </div>
            </div>
            <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
              <span style={{fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>{idx+1}/{trades.length}</span>
              <button className="btn btn-sm" disabled={idx<=0}                 onClick={()=>onNavigate(trades[idx-1])}>← Prev</button>
              <button className="btn btn-sm" disabled={idx>=trades.length-1}   onClick={()=>onNavigate(trades[idx+1])}>Next →</button>
              <button className="btn btn-sm" onClick={onClose}>✕</button>
            </div>
          </div>

          {/* Sub-section tabs */}
          <div style={{display:'flex',gap:4,marginTop:12,flexWrap:'wrap'}}>
            {SECTIONS.map(s => (
              <button key={s.id} onClick={()=>setSection(s.id)}
                style={{padding:'5px 12px',border:'1px solid',borderRadius:6,fontSize:11,cursor:'pointer',transition:'all .15s',fontFamily:'var(--font-sans)',fontWeight:500,
                  background:activeSection===s.id?'var(--ac)':'var(--sf)',borderColor:activeSection===s.id?'var(--ac)':'var(--bd)',color:activeSection===s.id?'#fff':'var(--tx2)'}}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── MODAL BODY ─────────────────────────────────────────────────── */}
        <div style={{padding:'18px 20px',maxHeight:'74vh',overflowY:'auto'}}>

          {/* Trade stat grid — always visible */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',gap:8,marginBottom:16}}>
            {[
              ['P&L',       fU(trade.pnl),                    pnlC,             'Net realised',     true],
              ['% RETURN',  pct,                               pnlPos?'var(--wn)':'var(--ls)','P&L / Notional', false],
              ['ENTRY',     trade.entry_price?.toLocaleString()||'—','var(--tx)','Price',            false],
              ['EXIT',      trade.exit_price?.toLocaleString()||'—', 'var(--tx)','Price',            false],
              ['PRICE MOVE',pts!=null?(pts>=0?'+':'')+pts.toFixed(5):'—', pnlC, trade.direction,    false],
              ['SIZE',      trade.size?.toLocaleString()||'—', 'var(--tx)',       'Contracts',        false],
              ['DURATION',  dur,                               'var(--tx)',        Math.round(trade.duration_mins||0)+'min', false],
              ['R-MULTIPLE',rDisplay!=null?rDisplay+'R':'Set stop →', rDisplay!=null&&parseFloat(rDisplay)>=1?'var(--wn)':'var(--ls)', 'Risk multiple', false],
            ].map(([l,v,c,s,priv])=>(
              <div key={l} style={{background:'var(--sf2)',border:'1px solid var(--bd)',borderRadius:7,padding:'10px 12px'}}>
                <div style={{fontSize:9,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:3}}>{l}</div>
                <div className={priv?'private':''} style={{fontFamily:'var(--font-mono)',fontSize:14,fontWeight:600,color:c,letterSpacing:'-.01em'}}>{v}</div>
                <div style={{fontSize:9,color:'var(--mu)',marginTop:2}}>{s}</div>
              </div>
            ))}
            {/* NOTIONAL — custom card with tooltip */}
            <div style={{background:'var(--sf2)',border:'1px solid var(--bd)',borderRadius:7,padding:'10px 12px',position:'relative'}}>
              <div style={{display:'flex',alignItems:'center',gap:4,marginBottom:3}}>
                <div style={{fontSize:9,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)'}}>NOTIONAL</div>
                {notionalTooltip && (
                  <span
                    onMouseEnter={()=>setShowNotionalTip(true)}
                    onMouseLeave={()=>setShowNotionalTip(false)}
                    onClick={()=>setShowNotionalTip(s=>!s)}
                    style={{fontSize:9,color:'var(--ac)',cursor:'pointer',lineHeight:1,userSelect:'none'}}>ⓘ</span>
                )}
              </div>
              <div className="private" style={{fontFamily:'var(--font-mono)',fontSize:14,fontWeight:600,color:'var(--mu)',letterSpacing:'-.01em'}}>{not}</div>
              <div style={{fontSize:9,color:'var(--mu)',marginTop:2}}>{trade.notional_method==='backsolve'?'Back-solved':trade.notional_method==='price_x_size'?'Price × size':'USD value'}</div>
              {showNotionalTip && notionalTooltip && (
                <div style={{position:'absolute',top:'calc(100% + 6px)',right:0,zIndex:100,background:'var(--sf)',border:'1px solid var(--bd)',borderRadius:7,padding:'10px 12px',boxShadow:'var(--sh-lg)',minWidth:260,maxWidth:320}}>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:6}}>HOW NOTIONAL WAS CALCULATED</div>
                  <div style={{fontSize:11,color:'var(--tx2)',fontFamily:'var(--font-mono)',lineHeight:1.7,whiteSpace:'pre-line'}}>{notionalTooltip}</div>
                </div>
              )}
            </div>
          </div>

          {/* ── CHART SECTION ─────────────────────────────────────────── */}
          {activeSection==='chart' && (
            <div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8,flexWrap:'wrap',gap:6}}>
                <div className="ct" style={{marginBottom:0}}><span className="ind" />TRADINGVIEW CHART</div>
                <div style={{display:'flex',alignItems:'center',gap:5,flexWrap:'wrap'}}>
                  <span style={{fontSize:10,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>TF:</span>
                  {[['1','1m'],['5','5m'],['15','15m'],['60','1H'],['D','1D']].map(([v,l])=>(
                    <button key={v} onClick={()=>setTf(v)}
                      style={{padding:'3px 9px',borderRadius:5,border:'1px solid',fontSize:11,fontFamily:'var(--font-mono)',cursor:'pointer',transition:'all .15s',
                        background:tf===v?'var(--ac)':'var(--sf)',borderColor:tf===v?'var(--ac)':'var(--bd)',color:tf===v?'#fff':'var(--tx2)',fontWeight:tf===v?600:400}}>
                      {l}
                    </button>
                  ))}
                  <a href={tvFull} target="_blank" rel="noreferrer" style={{fontSize:11,color:'var(--ac)',textDecoration:'none',fontFamily:'var(--font-mono)',marginLeft:4}}>Open full ↗</a>
                </div>
              </div>
              <div style={{borderRadius:8,overflow:'hidden',border:'1px solid var(--bd)',boxShadow:'var(--sh-sm)'}}>
                <iframe key={`${tvSym}-${tf}`} src={tvUrl} style={{width:'100%',height:400,border:'none',display:'block'}} allowTransparency scrolling="no" frameBorder="0" />
              </div>
              <div style={{marginTop:6,fontSize:10,color:'var(--mu)',fontFamily:'var(--font-mono)',textAlign:'center'}}>Navigate to entry/exit time · use TradingView toolbar to draw</div>
            </div>
          )}

          {/* ── P&L PATH SECTION ──────────────────────────────────────── */}
          {activeSection==='pnl' && sim && (
            <div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:12}}>
                {[
                  ['MAE',     fU(Math.round(sim.mae)),  sim.mae<0?'var(--ls)':'var(--wn)', 'Max adverse'],
                  ['MFE',     fU(Math.round(sim.mfe)),  'var(--wn)',                        'Max favorable'],
                  ['ACTUAL',  fU(Math.round(trade.pnl)),pnlC,                              'Exit result'],
                  ['CAPTURE', capture!=null?capture.toFixed(1)+'%':'N/A', qC(capture??50),'% of MFE'],
                ].map(([l,v,c,s])=>(
                  <div key={l} style={{background:'var(--sf2)',border:'1px solid var(--bd)',borderRadius:7,padding:'10px 12px',textAlign:'center'}}>
                    <div style={{fontSize:9,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:3}}>{l}</div>
                    <div className="private" style={{fontFamily:'var(--font-mono)',fontSize:15,fontWeight:700,color:c}}>{v}</div>
                    <div style={{fontSize:9,color:'var(--mu)',marginTop:2}}>{s}</div>
                  </div>
                ))}
              </div>
              <div style={{background:'var(--sf)',border:'1px solid var(--bd)',borderRadius:8,padding:'14px',marginBottom:12,boxShadow:'var(--sh-sm)'}}>
                <PnlPathChart sim={sim} trade={trade} />
                <div style={{marginTop:6,fontSize:10,color:'var(--mu)',fontFamily:'var(--font-mono)',textAlign:'center',lineHeight:1.5}}>
                  ⚠ P&L path is simulated using a random walk — real intrabar tick data is not available. MAE/MFE are estimates only.
                </div>
              </div>
              {/* Quality bars */}
              <div style={{background:'var(--sf2)',border:'1px solid var(--bd)',borderRadius:8,padding:'14px',marginBottom:12}}>
                <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:12}}>ENTRY & EXIT QUALITY</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
                  {[['Entry Quality',entryQ],['Exit Quality',exitQ]].map(([label,score])=>{
                    const c=qC(score)
                    return (
                      <div key={label}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                          <span style={{fontSize:11,color:'var(--tx2)',fontWeight:500}}>{label}</span>
                          <span style={{fontFamily:'var(--font-mono)',fontSize:13,fontWeight:700,color:c,background:'var(--sf3)',padding:'2px 8px',borderRadius:4}}>{score.toFixed(0)}%</span>
                        </div>
                        <div className="qt"><div className="qf" style={{width:score+'%',background:c}} /><div className="qk" style={{left:score+'%',background:c}} /></div>
                        <div style={{display:'flex',justifyContent:'space-between',fontSize:9,color:'var(--mu)',fontFamily:'var(--font-mono)',marginTop:4}}><span>POOR</span><span>OPTIMAL</span></div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── NOTES SECTION ─────────────────────────────────────────── */}
          {activeSection==='notes' && (
            <div>
              {/* Stop loss / R-Multiple */}
              <div style={{background:'var(--sf2)',border:'1px solid var(--bd)',borderRadius:8,padding:'14px',marginBottom:14}}>
                <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:10}}>RISK METRICS</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                  <div>
                    <div className="notes-label">Stop Loss Price (optional)</div>
                    <input className="inp" style={{width:'100%',fontFamily:'var(--font-mono)'}} type="number" placeholder={`e.g. ${trade.direction==='Long'?(trade.entry_price*0.99).toFixed(2):(trade.entry_price*1.01).toFixed(2)}`}
                      value={stopLoss} onChange={e=>setStopLoss(e.target.value)} />
                  </div>
                  <div>
                    <div className="notes-label">R-Multiple (auto-calculated)</div>
                    <div style={{fontFamily:'var(--font-mono)',fontSize:18,fontWeight:700,color:rDisplay!=null&&parseFloat(rDisplay)>=1?'var(--wn)':rDisplay!=null?'var(--ls)':'var(--mu)',padding:'7px 0'}}>
                      {rDisplay != null ? `${rDisplay}R` : '— enter stop loss'}
                    </div>
                  </div>
                </div>
              </div>
              {/* Structured notes */}
              <div style={{display:'grid',gap:12,marginBottom:12}}>
                {[
                  ['Why did you enter this trade?',           noteEntry,   setNoteEntry],
                  ['How did you manage the trade?',           noteMgmt,    setNoteMgmt],
                  ['What would you do differently next time?',noteLessons, setNoteLessons],
                  ['Emotional state during the trade',        noteEmotion, setNoteEmotion],
                ].map(([label,val,setter])=>(
                  <div key={label}>
                    <div className="notes-label">{label}</div>
                    <textarea className="notes-field" rows={2} placeholder="Type your notes…" value={val} onChange={e=>setter(e.target.value)} />
                  </div>
                ))}
                <div>
                  <div className="notes-label">Free-form notes (anything else)</div>
                  <textarea className="notes-field" rows={3} placeholder="Additional observations, market context, screenshots description…" value={noteFree} onChange={e=>setNoteFree(e.target.value)} />
                </div>
              </div>
              <button className="btn btn-p" onClick={handleSave} disabled={saving} style={{width:'100%',justifyContent:'center',padding:'8px'}}>
                {saving ? '💾 Saving…' : saved ? '✅ Saved!' : '💾 Save Notes & Stop Loss'}
              </button>
            </div>
          )}

          {/* ── IMAGES SECTION ────────────────────────────────────────── */}
          {activeSection==='images' && (
            <div>
              <div style={{fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)',marginBottom:14}}>
                Attach chart screenshots to this trade. Click any thumbnail to expand fullscreen.
              </div>
              <ImageGallery entityType="trade" entityId={trade.id} />
            </div>
          )}

          {/* ── TAGS SECTION ──────────────────────────────────────────── */}
          {activeSection==='tags' && (
            <div>
              {/* Category filter */}
              <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
                {tagCategories.map(cat => (
                  <button key={cat} onClick={()=>setTagCat(cat)}
                    style={{padding:'4px 12px',borderRadius:20,fontSize:11,fontWeight:500,cursor:'pointer',border:'1px solid',transition:'all .15s',textTransform:'capitalize',
                      background:tagCat===cat?(CAT_COLORS[cat]||'var(--ac)'):'var(--sf)',
                      borderColor:tagCat===cat?(CAT_COLORS[cat]||'var(--ac)'):'var(--bd)',
                      color:tagCat===cat?'#fff':'var(--tx2)'}}>
                    {cat}
                  </button>
                ))}
              </div>
              {/* Search */}
              <input className="inp" style={{width:'100%',marginBottom:12}} placeholder="🔍 Search tags…" value={tagSearch} onChange={e=>setTagSearch(e.target.value)} />
              {/* Tag grid */}
              <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:14}}>
                {filteredTags.map(tag => {
                  const isSelected = selectedTags.has(tag.id)
                  return (
                    <button key={tag.id} onClick={()=>setSelectedTags(prev => { const n=new Set(prev); isSelected?n.delete(tag.id):n.add(tag.id); return n })}
                      title={tag.description}
                      style={{padding:'5px 10px',borderRadius:6,fontSize:11,fontWeight:600,cursor:'pointer',border:`1px solid ${isSelected?tag.color:tag.color+'40'}`,transition:'all .15s',
                        background:isSelected?tag.color+'20':'var(--sf)',color:isSelected?tag.color:'var(--tx2)',
                        boxShadow:isSelected?`0 0 0 2px ${tag.color}40`:'none'}}>
                      {tag.name}
                    </button>
                  )
                })}
                {filteredTags.length === 0 && <div style={{color:'var(--mu)',fontSize:12}}>No tags match your search</div>}
              </div>
              {selectedTags.size > 0 && (
                <div style={{marginBottom:14,padding:'10px 12px',background:'var(--ac-bg)',border:'1px solid var(--ac-bd)',borderRadius:6}}>
                  <div style={{fontSize:11,color:'var(--ac2)',fontWeight:600,marginBottom:6}}>{selectedTags.size} tag{selectedTags.size>1?'s':''} selected:</div>
                  <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                    {tags.filter(t=>selectedTags.has(t.id)).map(t=>(
                      <span key={t.id} style={{padding:'2px 8px',borderRadius:4,fontSize:10,fontWeight:600,background:t.color+'20',color:t.color,border:`1px solid ${t.color}40`}}>{t.name}</span>
                    ))}
                  </div>
                </div>
              )}
              <button className="btn btn-p" onClick={handleSave} disabled={saving} style={{width:'100%',justifyContent:'center',padding:'8px'}}>
                {saving ? '💾 Saving…' : saved ? '✅ Saved!' : '💾 Save Tags'}
              </button>
            </div>
          )}

          {/* ── AI COACH SECTION ──────────────────────────────────────── */}
          {activeSection==='ai' && (
            <div>
              <div style={{background:'var(--sf2)',border:'1px solid var(--bd)',borderRadius:8,padding:'14px',marginBottom:14}}>
                <div style={{fontSize:12,color:'var(--tx2)',lineHeight:1.6,marginBottom:10}}>
                  AI will analyse this trade using price data, duration, session, R-multiple, and any notes you've added. The more notes you add, the more personalised the feedback.
                </div>
                <button className="btn btn-p" onClick={handleAI} disabled={aiLoading} style={{width:'100%',justifyContent:'center',padding:'9px',fontSize:13}}>
                  {aiLoading ? (
                    <><span style={{width:14,height:14,border:'2px solid rgba(255,255,255,.4)',borderTop:'2px solid #fff',borderRadius:'50%',display:'inline-block',animation:'spin 1s linear infinite'}} /> Analysing trade…</>
                  ) : '🧠 Get AI Analysis'}
                </button>
              </div>

              {aiError && (
                <div style={{background:'var(--wa-bg)',border:'1px solid var(--wa-bd)',borderRadius:8,padding:'12px 14px',color:'var(--wa-tx)',fontSize:12,lineHeight:1.6}}>
                  ℹ️ {aiError}
                </div>
              )}

              {aiResult && (
                <div style={{display:'grid',gap:12}}>
                  {/* Provider badge */}
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontSize:10,fontWeight:600,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)'}}>ANALYSIS BY</span>
                    <span style={{padding:'2px 8px',borderRadius:4,fontSize:10,fontWeight:600,background:'var(--ac-bg)',color:'var(--ac2)',border:'1px solid var(--ac-bd)',fontFamily:'var(--font-mono)'}}>
                      {aiResult.provider==='claude'?'Claude (Anthropic)':'Qwen-Plus (Alibaba)'}
                    </span>
                  </div>

                  {/* Insights */}
                  {aiResult.insights?.length > 0 && (
                    <div style={{background:'var(--sf2)',border:'1px solid var(--bd)',borderRadius:8,padding:'14px'}}>
                      <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:10}}>INSIGHTS</div>
                      <div style={{display:'grid',gap:8}}>
                        {aiResult.insights.map((ins,i) => (
                          <div key={i} style={{display:'flex',gap:10,padding:'8px 10px',background:'var(--sf)',borderRadius:6,border:'1px solid var(--bd)'}}>
                            <span style={{color:'var(--ac)',fontWeight:700,fontFamily:'var(--font-mono)',fontSize:11,flexShrink:0}}>{i+1}.</span>
                            <span style={{fontSize:12,color:'var(--tx2)',lineHeight:1.6}}>{ins}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Coaching tip */}
                  {aiResult.coaching_tip && (
                    <div style={{background:'var(--ac-bg)',border:'1px solid var(--ac-bd)',borderRadius:8,padding:'12px 14px'}}>
                      <div style={{fontSize:10,fontWeight:700,color:'var(--ac2)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:6}}>COACHING TIP</div>
                      <div style={{fontSize:12,color:'var(--tx2)',lineHeight:1.65}}>{aiResult.coaching_tip}</div>
                    </div>
                  )}

                  {/* Pattern flags */}
                  {aiResult.pattern_flags?.length > 0 && (
                    <div>
                      <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:6}}>PATTERN FLAGS</div>
                      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        {aiResult.pattern_flags.map((f,i) => (
                          <span key={i} style={{padding:'3px 10px',borderRadius:4,fontSize:10,fontWeight:600,background:'var(--wa-bg)',color:'var(--wa-tx)',border:'1px solid var(--wa-bd)',fontFamily:'var(--font-mono)'}}>
                            ⚡ {f.replace(/_/g,' ')}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Rule compliance */}
                  {(aiResult.rule_compliance?.followed?.length > 0 || aiResult.rule_compliance?.broken?.length > 0) && (
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                      <div style={{background:'var(--wn-bg)',border:'1px solid var(--wn-bd)',borderRadius:8,padding:'12px'}}>
                        <div style={{fontSize:10,fontWeight:700,color:'var(--wn-tx)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:6}}>✓ RULES FOLLOWED</div>
                        {aiResult.rule_compliance.followed?.map((r,i) => <div key={i} style={{fontSize:11,color:'var(--wn-tx)',marginBottom:3}}>· {r}</div>)}
                      </div>
                      <div style={{background:'var(--ls-bg)',border:'1px solid var(--ls-bd)',borderRadius:8,padding:'12px'}}>
                        <div style={{fontSize:10,fontWeight:700,color:'var(--ls-tx)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:6}}>✗ RULES BROKEN</div>
                        {aiResult.rule_compliance.broken?.map((r,i) => <div key={i} style={{fontSize:11,color:'var(--ls-tx)',marginBottom:3}}>· {r}</div>)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
