import MarketChart from './MarketChart'
import {durationLabel,money as amountLabel} from '../lib/presentation'
import {draftKey,readNoteDraft,writeNoteDraft,NOTE_TEMPLATES} from '../lib/noteDraft'
import { journalFetch } from '../lib/request'
import { riskMultiple } from '../lib/journalNotes'
import { useState, useEffect, useCallback, useRef } from 'react'
import ExecutionPanel from './ExecutionPanel'
import { simulatePnLPath } from '../lib/tradeUtils'
import { PnlPathChart } from './Charts'
import ImageGallery from './ImageGallery'

const usdFormat = (n,d=0) => (n>=0?'+':'')+n.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:d,maximumFractionDigits:d})
const fPct = (n,d=3) => (n>=0?'+':'')+n.toFixed(d)+'%'
const SESSION_CLASS = { Asia:'pill-asia', London:'p-lon', 'London/NY Overlap':'p-ov', 'New York':'p-ny' }

const CAT_COLORS = {
  Psychology: '#ea580c', Setup: '#1a56db', Risk: '#dc2626',
  Journal: '#059669', Market: '#7c3aed', Custom: '#6b7280',
}

export default function TradeModal({ trade, onClose, trades, onNavigate, tags = [], onSaved,preview=false }) {
  const panelRef=useRef(null)
  useEffect(()=>{const panel=panelRef.current;if(!panel)return;const previous=document.activeElement,overflow=document.body.style.overflow;document.body.style.overflow='hidden';panel.querySelector('[aria-label="Close trade"]')?.focus();const trap=e=>{if(e.key!=='Tab')return;const items=[...panel.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary')].filter(el=>el.getClientRects().length);if(!items.length)return;const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}};panel.addEventListener('keydown',trap);return()=>{document.body.style.overflow=overflow;panel.removeEventListener('keydown',trap);previous?.focus?.()}},[])
  const [sim,         setSim]         = useState(null)
  const [activeSection, setSection]   = useState(trade?.execution_count ? 'executions' : 'summary')

  // Notes state — pre-populate from trade if already saved
  const [noteEntry,   setNoteEntry]   = useState('')
  const [noteMgmt,    setNoteMgmt]    = useState('')
  const [noteLessons, setNoteLessons] = useState('')
  const [noteEmotion, setNoteEmotion] = useState('')
  const [noteFree,    setNoteFree]    = useState('')
  const [stopLoss,    setStopLoss]    = useState('')
  const [saving,      setSaving]      = useState(false)
  const [showNotionalTip, setShowNotionalTip] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [revision, setRevision] = useState(trade.journal_revision ?? 0)
  const tradeIdRef = useRef(trade.id)
  tradeIdRef.current = trade.id
  const [saved,       setSaved]       = useState(false)

  // Tags state
  const [selectedTags, setSelectedTags] = useState(new Set(trade.tag_ids || []))
  const [tagCat,        setTagCat]      = useState('all')
  const [tagSearch,     setTagSearch]   = useState('')

  // AI coach state
  const [aiLoading,   setAiLoading]   = useState(false)
  const [aiResult,    setAiResult]    = useState(null)
  const [aiError,     setAiError]     = useState(null)

  const [recoveredDraft,setRecoveredDraft]=useState(null),[draftMessage,setDraftMessage]=useState('')
  const dirtyNotes=useRef(false)
  const idx = trades.findIndex(item => item.id === trade.id)

  // Load saved values when trade changes
  useEffect(() => {
    if (!trade) return
    setSim(null)
    dirtyNotes.current=false;setDraftMessage('')
    if(typeof window!=='undefined')setRecoveredDraft(readNoteDraft(window.localStorage,trade))
    setNoteEntry(trade.note_entry_reason    || '')
    setNoteMgmt(trade.note_management       || '')
    setNoteLessons(trade.note_lessons       || '')
    setNoteEmotion(trade.note_emotional_state || '')
    setNoteFree(trade.notes                 || '')
    setStopLoss(trade.stop_loss != null ? String(trade.stop_loss) : '')
    setSelectedTags(new Set(trade.tag_ids || []))
    setSaveError(''); setSaving(false); setRevision(trade.journal_revision ?? 0)
    setAiResult(null); setAiError(null); setSaved(false)
    setSection(trade.execution_count ? 'executions' : 'summary')
  }, [trade.id])

  const hasTagChanges=JSON.stringify([...selectedTags].sort())!==JSON.stringify([...(trade.tag_ids || [])].sort())
  const canLeave=()=>!dirtyNotes.current&&!hasTagChanges || (typeof window!=='undefined'&&window.confirm('This trade has unsaved changes. Leave this trade? Note drafts remain on this browser; unsaved tag changes will be discarded.'))
  const closeSafely=()=>{if(!saving&&canLeave())onClose()}
  const navigateSafely=next=>{if(!saving&&next&&canLeave())onNavigate(next)}
  const values=()=>({notes:noteFree,note_entry_reason:noteEntry,note_management:noteMgmt,note_lessons:noteLessons,note_emotional_state:noteEmotion,stop_loss:stopLoss})
  const remember=(patch)=>{dirtyNotes.current=true;setSaved(false);try{writeNoteDraft(window.localStorage,trade,{...values(),...patch},revision);setDraftMessage('Draft saved on this browser. Save Notes to update the journal.')}catch{setDraftMessage('Draft could not be stored on this browser. Keep this window open until saved.')}}
  const applyValues=patch=>{const setters={notes:setNoteFree,note_entry_reason:setNoteEntry,note_management:setNoteMgmt,note_lessons:setNoteLessons,note_emotional_state:setNoteEmotion,stop_loss:setStopLoss};Object.entries(patch).forEach(([key,value])=>setters[key]?.(value));remember(patch)}
  const handleKey=useCallback(e=>{
    if(['INPUT','TEXTAREA','SELECT'].includes(e.target?.tagName)||e.target?.isContentEditable)return
    if(e.key==='Escape')closeSafely()
    if(e.key==='ArrowLeft'&&idx>0)navigateSafely(trades[idx-1])
    if(e.key==='ArrowRight'&&idx<trades.length-1)navigateSafely(trades[idx+1])
  },[idx,trades,onClose,onNavigate,saving,hasTagChanges])
  useEffect(()=>{document.addEventListener('keydown',handleKey);return()=>document.removeEventListener('keydown',handleKey)},[handleKey])
  useEffect(()=>{if(typeof window==='undefined')return;const guard=e=>{if(dirtyNotes.current||hasTagChanges){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard)},[hasTagChanges])

  if (!trade) return null

  const fU=(n,d=0)=>['USD','USDC','USDT'].includes(trade.currency)?usdFormat(n,d):`${Number(n).toFixed(d)} ${trade.currency || 'currency unknown'}`
  const pnlPos = trade.pnl >= 0
  const pnlC   = pnlPos ? 'var(--wn)' : 'var(--ls)'


  const priceMove = trade.exit_price && trade.entry_price ? trade.exit_price - trade.entry_price : null
  const pts       = priceMove != null ? (trade.direction==='Long' ? priceMove : -priceMove) : null
  const pctVal = !trade.data_check && (trade.entry_price && trade.exit_price && trade.entry_price > 0)
    ? (trade.direction === 'Long'
        ? (trade.exit_price / trade.entry_price - 1) * 100
        : ((trade.entry_price - trade.exit_price) / trade.entry_price) * 100)
    : (trade.data_check?null:trade.pct_gain)
  const pct = pctVal != null ? fPct(pctVal) : '—'
  const dur = durationLabel(trade.duration_mins)
  const not = trade.notional_usd ? '$'+Math.round(trade.notional_usd).toLocaleString() : '—'

  // Build notional audit tooltip
  const notionalTooltip = (() => {
    if (!trade.notional_usd || !trade.entry_price || !trade.exit_price) return null
    const move = trade.direction === 'Long'
      ? (trade.exit_price / trade.entry_price - 1) * 100
      : ((trade.entry_price - trade.exit_price) / trade.entry_price) * 100
    if (trade.notional_method === 'backsolve') {
      return `Back-solved from price move\nEntry ${trade.entry_price?.toLocaleString()} → Exit ${trade.exit_price?.toLocaleString()}\nMove: ${move>=0?'+':''}${move.toFixed(3)}% · $${Math.abs(Math.round(trade.pnl)).toLocaleString()} ÷ ${Math.abs(move).toFixed(3)}% = ${not}`
    } else if (trade.notional_method === 'price_x_size') {
      return `Calculated as price × size\nEntry ${trade.entry_price?.toLocaleString()} × ${trade.size?.toLocaleString()} contracts = ${not}`
    }
    return null
  })()

  const capture  = sim && sim.mfe > 0 ? Math.max(0, Math.min(100, trade.pnl/sim.mfe*100)) : null
  const entryQ   = sim && sim.mfe > 0 ? Math.max(0, Math.min(100, 100*(1-Math.abs(sim.mae)/Math.max(Math.abs(sim.mae)+sim.mfe, .01)))) : 50
  const exitQ    = capture ?? 50
  const qC       = v => v>=70?'var(--wn)':v>=40?'var(--wa)':'var(--ls)'

  // Computed R-Multiple from live stop loss input
  const computedR = trade.data_check?null:riskMultiple(trade, stopLoss)
  const rDisplay = computedR

  const handleSave = async (section = 'notes') => {
    if (saving || preview) return
    const id = trade.id
    setSaving(true); setSaved(false); setSaveError('')
    try {
      const res = await journalFetch('/api/trade-notes', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ tradeId:id, expectedRevision:revision,
          ...(section === 'tags' ? { tagIds:[...selectedTags] } : {
            notes:noteFree, note_entry_reason:noteEntry, note_management:noteMgmt,
            note_lessons:noteLessons, note_emotional_state:noteEmotion,
            stop_loss:stopLoss === '' ? null : Number(stopLoss),
          }),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success || !data.trade) throw new Error(data.error || 'Could not save. Please retry.')
      if(section==='notes'){try{window.localStorage.removeItem(draftKey(trade))}catch{};dirtyNotes.current=false;setRecoveredDraft(null);setDraftMessage('')}
      if (onSaved) onSaved(data.trade)
      if (tradeIdRef.current !== id) return
      setRevision(data.trade.journal_revision); setSaved(section)
    } catch (error) { if (tradeIdRef.current === id) setSaveError(error.message || 'Could not save. Your changes are still here.') }
    finally { if (tradeIdRef.current === id) setSaving(false) }
  }

  // AI analysis
  const handleAI = async () => {
    if(preview)return
    setAiLoading(true); setAiError(null); setAiResult(null)
    try {
      const res  = await journalFetch('/api/ai-coach', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          trade: { ...trade, r_multiple: rDisplay, stop_loss: stopLoss === '' ? null : Number(stopLoss) },
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
  }).sort((a,b)=>Number(selectedTags.has(b.id))-Number(selectedTags.has(a.id)))
  const tagCategories = ['all', ...new Set(tags.map(t => t.category.toLowerCase()))]

  // Section nav
  const SECTIONS = [
    {id:'summary',label:'Summary'},
    { id:'executions', label:'Executions' },
    { id:'chart',label:'Market chart' },
    { id:'notes',  label:'Review notes' },
    { id:'images', label:'Screenshots' },
    { id:'tags',   label:'Tags' },
    { id:'ai',     label:'AI Coach' },
  ]

  return (
    <div className="mo trade-detail-overlay" onClick={e=>e.target===e.currentTarget&&closeSafely()}>
      <div ref={panelRef} className="mb trade-detail-panel" role="dialog" aria-modal="true" aria-label={`${trade.symbol} trade details`}>

        {/* ── MODAL HEADER ─────────────────────────────────────────────── */}
        <div className="mh">
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
            <div>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                <span style={{fontSize:11,padding:'3px 8px',fontWeight:700,borderRadius:4,color:trade.direction==='Long'?'#00b5a3':'#ffb300',background:trade.direction==='Long'?'rgba(0,181,163,.12)':'rgba(255,179,0,.12)',border:`1px solid ${trade.direction==='Long'?'#00b5a3':'#ffb300'}`}}>
                  {trade.direction==='Long'?'▲':'▼'} {trade.direction}
                </span>
                <span style={{fontWeight:700,fontSize:16}}>{trade.symbol}</span>
                <span style={{color:'var(--bd2)'}}>·</span>
                <span className="private" style={{fontFamily:'var(--font-mono)',fontSize:15,fontWeight:700,color:pnlC}}>{fU(trade.pnl)}</span>
                <span className={`pill ${pnlPos?'pb':'pr'}`}>{trade.pnl===0?'BREAKEVEN':pnlPos?'WIN':'LOSS'}</span>
                {rDisplay != null && <span style={{fontFamily:'var(--font-mono)',fontSize:11,color:parseFloat(rDisplay)>=1?'var(--wn)':'var(--ls)',fontWeight:600,background:'var(--sf3)',padding:'2px 7px',borderRadius:4}}>{rDisplay}R</span>}
              </div>
              <div style={{fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>
                {trade.entry_time?.slice(0,16).replace('T',' ')} → {trade.exit_time?.slice(0,16).replace('T',' ')} GMT
                &nbsp;·&nbsp;{trade.session}&nbsp;·&nbsp;{trade.day_of_week}&nbsp;·&nbsp;{dur}
              </div>
              <div style={{fontSize:11,color:'var(--mu)',marginTop:5}}>
                {trade.underlying && <>Family: {trade.underlying} · </>}
                Saved ticker: {trade.original_symbol || trade.symbol}
                {trade.contract_symbol && <> · Contract: {trade.contract_symbol}</>}
                {trade.product_type && trade.product_type !== 'Broker instrument' && <> · {trade.product_type}</>}
                {trade.inverse && <> · {trade.exposure_direction} Bitcoin exposure (daily inverse)</>}
              </div>
            </div>
            <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
              <span style={{fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)'}}>{idx+1}/{trades.length}</span>
              <button className="btn btn-sm" disabled={idx<=0}                 onClick={()=>navigateSafely(trades[idx-1])}>← Prev</button>
              <button className="btn btn-sm" disabled={idx>=trades.length-1}   onClick={()=>navigateSafely(trades[idx+1])}>Next →</button>
              <button className="btn btn-sm" onClick={closeSafely} aria-label="Close trade">×</button>
            </div>
          </div>

          {/* Sub-section tabs */}
          <div style={{display:'flex',gap:4,marginTop:12,flexWrap:'wrap'}}>
            {SECTIONS.map(s => (
              <button key={s.id} aria-pressed={activeSection===s.id} onClick={()=>setSection(s.id)}
                style={{padding:'5px 12px',border:'1px solid',borderRadius:6,fontSize:11,cursor:'pointer',transition:'all .15s',fontFamily:'var(--font-sans)',fontWeight:500,
                  background:activeSection===s.id?'var(--ac)':'var(--sf)',borderColor:activeSection===s.id?'var(--ac)':'var(--bd)',color:activeSection===s.id?'#fff':'var(--tx2)'}}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── MODAL BODY ─────────────────────────────────────────────────── */}
        <div className="trade-detail-body">

          <div className="trade-detail-metrics">{[['Reported P&L',fU(trade.pnl),true],['Price move',pct,false],['Risk multiple',rDisplay!=null?rDisplay+'R':'Not recorded',false],['Duration',dur,false]].map(([label,value,priv])=><div key={label}><span>{label}</span><strong className={priv?'private':''}>{value}</strong></div>)}</div>
          <details className="trade-facts"><summary>Position facts & data coverage</summary><dl><div><dt>Average entry</dt><dd>{trade.entry_price?.toLocaleString()||'Unavailable'}{trade.broker==='PrimeXBT'||trade.broker==='IBKR'?' · matched from export history':''}</dd></div><div><dt>Average exit</dt><dd>{trade.exit_price?.toLocaleString()||'Unavailable'}</dd></div><div><dt>Position size</dt><dd>{trade.size?.toLocaleString()}</dd></div><div><dt>Estimated notional</dt><dd className="private">{not}</dd></div><div><dt>Account</dt><dd>{trade.account_id}</dd></div></dl><p>MAE, MFE and execution-quality scores require observed intratrade prices; this export does not provide them.</p></details>
          {trade.data_check&&<div className="data-check-notice" role="status">{trade.data_check}</div>}
          {preview&&<div className="preview-inline">Sample trade · Editing and external services are disabled in this design preview.</div>}
          {activeSection==='summary'&&<section className="trade-summary"><h2>Review the position</h2><p>The reported outcome is shown above. Inspect the recorded fills, then capture the reasoning behind your decisions.</p><div className="summary-actions"><button className="btn btn-p" onClick={()=>setSection('notes')}>Write a review</button><button className="btn" onClick={()=>setSection('executions')}>Inspect executions</button></div>{trade.notes&&<blockquote>{trade.notes}</blockquote>}</section>}
          {activeSection==='executions' && (preview?<div className="sample-executions"><h2>Execution breakdown</h2><p>Representative sample · entries, additions and reductions</p><table><thead><tr><th>Action</th><th>Quantity</th><th>Price</th></tr></thead><tbody>{[['Entry','2',trade.entry_price],['Add','3',trade.entry_price],['Close','5',trade.exit_price]].map(([action,q,p])=><tr key={action}><td>{action}</td><td>{q}</td><td>{p.toLocaleString()}</td></tr>)}</tbody></table></div>:<ExecutionPanel trade={trade}/>)}
          {/* ── CHART SECTION ─────────────────────────────────────────── */}
          <MarketChart key={trade.id} trade={trade} active={activeSection==='chart'} preview={preview}/>

          {/* ── P&L PATH SECTION ──────────────────────────────────────── */}
          {activeSection==='pnl' && <div style={{padding:24,lineHeight:1.7}}><h3>Intratrade price history unavailable</h3><p>Your exports include executions and realised P&amp;L, but no continuous market-price history. MAE, MFE, capture rate and entry/exit quality cannot be measured from these files.</p><p>Open Execution details to inspect the recorded fills and average cost where available.</p></div>}

          {/* ── NOTES SECTION ─────────────────────────────────────────── */}
          {activeSection==='notes' && (
            <div className="review-editor">
              {recoveredDraft&&<div role="status" style={{padding:12,border:'1px solid var(--wa)',marginBottom:12}}><p>A note draft from {new Date(recoveredDraft.savedAt).toLocaleString()} is available on this browser.{recoveredDraft.revision!==revision?' The saved trade has changed since this draft; compare it before saving.':''}</p><button className="btn" onClick={()=>{applyValues(recoveredDraft.values);setRecoveredDraft(null)}}>Restore draft</button><button className="btn" onClick={()=>{try{window.localStorage.removeItem(draftKey(trade))}catch{}setRecoveredDraft(null)}}>Discard draft</button></div>}
              <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>{Object.entries(NOTE_TEMPLATES).map(([name,patch])=><button className="btn btn-sm" key={name} onClick={()=>applyValues(Object.fromEntries(Object.entries(patch).map(([key,value])=>[key,values()[key]?values()[key]+'\n\n'+value:value])))}>Add {name.toLowerCase()} prompts</button>)}</div>
              {draftMessage&&<p role="status" style={{fontSize:11,color:'var(--mu)'}}>{draftMessage}</p>}
              {/* Stop loss / R-Multiple */}
              <details className="review-risk"><summary>Stop loss &amp; risk multiple · optional</summary><div style={{background:'var(--sf2)',border:'1px solid var(--bd)',borderRadius:8,padding:'14px',marginBottom:14}}>
                <div style={{fontSize:10,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',fontFamily:'var(--font-mono)',marginBottom:10}}>RISK METRICS</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                  <div>
                    <div className="notes-label">Stop Loss Price (optional)</div>
                    <input disabled={saving} className="inp" aria-label="Stop loss price" style={{width:'100%',fontFamily:'var(--font-mono)'}} type="number" placeholder={`e.g. ${trade.direction==='Long'?(trade.entry_price*0.99).toFixed(2):(trade.entry_price*1.01).toFixed(2)}`}
                      value={stopLoss} onChange={e=>{ setStopLoss(e.target.value); remember({stop_loss:e.target.value}) }} />
                  </div>
                  <div>
                    <div className="notes-label">R-Multiple (auto-calculated)</div>
                    <div style={{fontFamily:'var(--font-mono)',fontSize:18,fontWeight:700,color:rDisplay!=null&&parseFloat(rDisplay)>=1?'var(--wn)':rDisplay!=null?'var(--ls)':'var(--mu)',padding:'7px 0'}}>
                      {rDisplay != null ? `${rDisplay}R` : '— enter stop loss'}
                    </div>
                  </div>
                </div>
              </div></details>
              {/* Structured notes */}
              <div style={{display:'grid',gap:12,marginBottom:12}}>
                {[
                  ['Why did you enter this trade?',noteEntry,setNoteEntry,'note_entry_reason'],
                  ['How did you manage the trade?',noteMgmt,setNoteMgmt,'note_management'],
                  ['What would you do differently next time?',noteLessons,setNoteLessons,'note_lessons'],
                  ['Emotional state during the trade',noteEmotion,setNoteEmotion,'note_emotional_state'],
                ].map(([label,val,setter,key])=>(
                  <div key={label}>
                    <div className="notes-label">{label}</div>
                    <textarea aria-label={label} disabled={saving} className="notes-field" maxLength={20000} rows={2} placeholder="Type your notes…" value={val} onChange={e=>{ setter(e.target.value); remember({[key]:e.target.value}) }} />
                  </div>
                ))}
                <div>
                  <div className="notes-label">Free-form notes (anything else)</div>
                  <textarea aria-label="Additional notes" disabled={saving} className="notes-field" maxLength={20000} rows={3} placeholder="Additional observations, market context, screenshots description…" value={noteFree} onChange={e=>{ setNoteFree(e.target.value); remember({notes:e.target.value}) }} />
                </div>
              </div>
              <button className="btn btn-p" onClick={()=>handleSave('notes')} disabled={saving||preview} style={{width:'100%',justifyContent:'center',padding:'8px'}}>
                {saving ? 'Saving…' : saved === 'notes' ? 'Saved' : 'Save notes & stop loss'}
              </button>
            </div>
          )}

          {/* ── IMAGES SECTION ────────────────────────────────────────── */}
          {activeSection==='images' && (
            <div>
              <div style={{fontSize:11,color:'var(--mu)',fontFamily:'var(--font-mono)',marginBottom:14}}>
                Attach chart screenshots to this trade. Click any thumbnail to expand fullscreen.
              </div>
              <>{preview?<p className="preview-inline">No screenshots in this sample. Your live journal keeps existing screenshots attached to each trade.</p>:<ImageGallery entityType="trade" entityId={trade.id}/>}</>
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
              <input disabled={saving} className="inp" style={{width:'100%',marginBottom:12}} placeholder="Search all tags…" value={tagSearch} onChange={e=>setTagSearch(e.target.value)} />
              {/* Tag grid */}
              <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:14}}>
                {(tagSearch?filteredTags:filteredTags.slice(0,24)).map(tag => {
                  const isSelected = selectedTags.has(tag.id)
                  return (
                    <button disabled={saving} key={tag.id} onClick={()=>{ setSaved(false); setSelectedTags(prev => { const n=new Set(prev); isSelected?n.delete(tag.id):n.add(tag.id); return n }) }}
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
              <button className="btn btn-p" onClick={()=>handleSave('tags')} disabled={saving||preview} style={{width:'100%',justifyContent:'center',padding:'8px'}}>
                {saving ? 'Saving…' : saved === 'tags' ? 'Saved' : 'Save tags'}
              </button>
            </div>
          )}

          {saveError && <div role="alert" style={{color:'var(--ls)',padding:'12px 0',fontSize:12}}>{saveError}</div>}

          {/* ── AI COACH SECTION ──────────────────────────────────────── */}
          {activeSection==='ai' && (
            <div><p style={{fontSize:12,color:'var(--mu)',lineHeight:1.7}}>Generate sends this trade and its note text to the configured AI provider. Coaching scores are subjective opinions; check them against the recorded data.</p>
              <div style={{background:'var(--sf2)',border:'1px solid var(--bd)',borderRadius:8,padding:'14px',marginBottom:14}}>
                <div style={{fontSize:12,color:'var(--tx2)',lineHeight:1.6,marginBottom:10}}>
                  AI will analyse this trade using price data, duration, session, R-multiple, and any notes you've added. The more notes you add, the more personalised the feedback.
                </div>
                <button className="btn btn-p" onClick={handleAI} disabled={aiLoading||preview} style={{width:'100%',justifyContent:'center',padding:'9px',fontSize:13}}>
                  {aiLoading ? (
                    <><span style={{width:14,height:14,border:'2px solid rgba(255,255,255,.4)',borderTop:'2px solid #fff',borderRadius:'50%',display:'inline-block',animation:'spin 1s linear infinite'}} /> Analysing trade…</>
                  ) : 'Generate coaching notes'}
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
