import { Fragment, useEffect, useMemo, useState } from 'react'
import { executionView } from '../lib/executionUtils'
const num = value => value == null ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 8 })
const money = value => value == null ? '—' : Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 })
const cell = { padding: '9px 10px', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: 11 }

export default function ExecutionPanel({ trade }) {
  const [record, setRecord] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [timezone, setTimezone] = useState('Asia/Dubai'), [raw, setRaw] = useState(false), [expanded, setExpanded] = useState(new Set()), [retry, setRetry] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    setLoading(true); setRecord(null); setError(''); setRaw(false); setExpanded(new Set())
    fetch(`/api/executions?tradeId=${encodeURIComponent(trade.id)}`, { signal: abort.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data.record })
      .then(data => { if (!abort.signal.aborted) { setRecord(data); setTimezone(data?.source.timezone || 'Asia/Dubai') } })
      .catch(err => { if (!abort.signal.aborted) setError(err.message || 'Execution details could not be loaded.') })
      .finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => abort.abort()
  }, [trade.id, retry])
  const view = useMemo(() => record ? executionView(record.fills) : null, [record])
  const timestamp = value => new Date(value).toLocaleString('en-GB', { timeZone: timezone, day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' })
  if (loading) return <div role="status" style={{padding:30,color:'var(--mu)'}}>Loading execution details…</div>
  if (error) return <div role="alert" style={{padding:20}}>{error} <button className="btn btn-sm" onClick={() => setRetry(value => value + 1)}>Retry</button></div>
  if (!record) return <div style={{background:'var(--sf2)',padding:22,border:'1px solid var(--bd)',borderRadius:8}}>
    <div style={{fontWeight:600,marginBottom:8}}>No execution history attached yet</div>
    <div style={{fontSize:12,color:'var(--mu)',lineHeight:1.7}}>{['TxFlow','Hyperliquid'].includes(trade.broker)
      ? 'Re-upload the original history CSV to attach individual fills. Notes, tags and the trade count are preserved.'
      : `The consolidated summary is saved. Execution imports for ${trade.broker} are not available yet.`}</div>
  </div>
  const toggle = index => setExpanded(old => { const next = new Set(old); next.has(index) ? next.delete(index) : next.add(index); return next })
  const rawTable = fills => <table style={{width:'100%',minWidth:670}}>
    <thead><tr>{['Time','Side','Quantity','Fill price','Fee','Reported P&L','Source'].map(label => <th key={label}>{label}</th>)}</tr></thead>
    <tbody>{fills.map(fill => <tr key={`${fill.source_key}-${fill.action}-${fill.index}`}>
      <td style={cell}>{timestamp(fill.time)}</td><td style={cell}>{fill.side}</td><td style={cell}>{num(fill.quantity)}</td><td style={cell}>{num(fill.price)}</td>
      <td style={cell} className="private">{money(fill.fee)}</td><td style={cell} className="private">{money(fill.reported_pnl)}</td>
      <td style={cell}><details><summary style={{cursor:'pointer',color:'var(--ac)'}}>CSV row {fill.source_row_number}</summary>
        <div style={{whiteSpace:'normal',maxWidth:320,lineHeight:1.6,padding:'6px 0',overflowWrap:'anywhere'}}>
          Original time: {fill.source_time}<br />{fill.liquidity && <>Liquidity: {fill.liquidity}<br /></>}
          {fill.allocated && <>This execution is allocated between positions.<br /></>}
          {fill.transaction_hash && <>Transaction: {fill.transaction_hash}<br /></>}
          <span className="private">{JSON.stringify(fill.source_row)}</span>
        </div></details></td>
    </tr>)}</tbody>
  </table>
  return <section aria-label="Execution details">
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap',marginBottom:12}}>
      <div><div style={{fontWeight:700,fontSize:14}}>Execution breakdown</div><div style={{fontSize:11,color:'var(--mu)',marginTop:4}}>{record.fills.length} fills · {view.batches.length} batches · {view.entry_count} opening / {view.exit_count} closing fills</div></div>
      <label style={{fontSize:11,color:'var(--mu)'}}>Times shown in <select className="inp" aria-label="Execution timezone" value={timezone} onChange={event => setTimezone(event.target.value)} style={{marginLeft:6}}>
        {[...new Set([record.source.timezone, 'Asia/Dubai','UTC'])].filter(Boolean).map(zone => <option key={zone}>{zone}</option>)}
      </select></label>
    </div>
    {!view.complete && <div role="status" style={{padding:12,marginBottom:12,background:'var(--sf2)',border:'1px solid var(--wa)',borderRadius:6,fontSize:12,lineHeight:1.6}}>Some opening fills are missing from this export. Running balances and average costs cover the available fills only; the saved trade P&L is unchanged.</div>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:8,marginBottom:14}}>
      {[
        ['Avg entry execution',num(view.average_entry)],['Avg exit execution',num(view.average_exit)],
        ['Realised avg cost',num(view.realised_average_cost)],['Remaining quantity',view.complete ? num(view.remaining) : 'Incomplete history'],
        ['Remaining avg cost',view.complete ? num(view.average_cost) : 'Unavailable'],['All fill fees',money(view.fees)],
      ].map(([label,value]) => <div key={label} style={{padding:10,background:'var(--sf2)',border:'1px solid var(--bd)',borderRadius:7}}><div style={{fontSize:10,color:'var(--mu)',marginBottom:5}}>{label}</div><div className="private" style={{fontSize:13,fontWeight:600,fontFamily:'var(--font-mono)'}}>{value}</div></div>)}
    </div>
    <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:10,flexWrap:'wrap'}}>
      <button className="btn btn-sm" aria-pressed={!raw} onClick={() => setRaw(false)}>Batches</button>
      <button className="btn btn-sm" aria-pressed={raw} onClick={() => setRaw(true)}>All {record.fills.length} fills</button>
      <span style={{fontSize:10,color:'var(--mu)',marginLeft:6}}>Timestamp batches group fills at the same second. They are not confirmed orders.</span>
    </div>
    <div className="tw" style={{border:'1px solid var(--bd)',borderRadius:8,overflowX:'auto'}}>
      {raw ? rawTable(view.rows) : <table style={{width:'100%',minWidth:860}}>
        <thead><tr>{['Batch / time','Action','Quantity','Avg price','Fees','Remaining','Avg cost after'].map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{view.batches.map((batch,index) => <Fragment key={`${batch.key}-${index}`}>
          <tr><td style={cell}><button className="btn btn-sm" aria-expanded={expanded.has(index)} aria-label={`${expanded.has(index)?'Collapse':'Expand'} batch ${index+1}`} onClick={() => toggle(index)}>{expanded.has(index)?'▾':'▸'} {batch.fills.length} fill{batch.fills.length===1?'':'s'}</button><div style={{marginTop:5}}>{timestamp(batch.time)}</div><div style={{color:'var(--mu)',fontSize:9,marginTop:3}}>{batch.grouping==='order' ? `Order ${batch.order_id}` : 'Timestamp batch'}</div></td>
            <td style={{...cell,color:batch.action==='open'?'var(--wn)':'var(--wa)'}}>{batch.label}</td><td style={cell}>{num(batch.quantity)}</td><td style={cell}>{num(batch.price)}</td><td style={cell} className="private">{money(batch.fee)}</td><td style={cell}>{view.complete ? num(batch.remaining) : '—'}</td><td style={cell}>{view.complete ? num(batch.average_cost) : '—'}</td></tr>
          {expanded.has(index) && <tr><td colSpan={7} style={{padding:12,background:'var(--sf2)'}}><div style={{fontSize:11,fontWeight:600,marginBottom:8}}>Individual fills · batch {index+1}</div><div style={{overflowX:'auto'}}>{rawTable(batch.fills)}</div></td></tr>}
        </Fragment>)}</tbody>
      </table>}
    </div>
    <div style={{fontSize:11,color:'var(--mu)',lineHeight:1.7,marginTop:12}}>
      Prices are quantity-weighted and exclude fees. Realised average cost follows reductions and subsequent additions; remaining average cost applies only to the open balance.<br />
      {record.pnl_basis}<br />Source: {record.source.filename} · CSV timezone: {record.source.timezone}
    </div>
  </section>
}
