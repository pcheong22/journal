import {useState} from 'react'
import {journalFetch} from '../lib/request'
export default function ReviewWorkflow({trades,pageTrades,tags,inbox,setInbox,selection,setSelection,onSaved,filters,onApply,savedViews,onSaveViews,onWeekly,preview=false}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[tag,setTag]=useState(''),[name,setName]=useState('')
 const reviewed=tags.find(t=>t.name==='Reviewed')?.id
 const unreviewed=trades.filter(t=>!t.tag_ids?.includes(reviewed)).length
 const bulk=async(tagId=null,remove=false)=>{setBusy(true);setError('');try{
  const chosen=trades.filter(t=>selection.has(t.id));if(!chosen.length)throw new Error('Select trades first.')
  const {trades:updated}=await(await journalFetch('/api/bulk-tags',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({trades:chosen.map(t=>({id:t.id,revision:t.journal_revision??0})),tagId,remove})})).json()
  await onSaved(updated);setSelection(new Set())
 }catch(e){setError(e.message)}finally{setBusy(false)}}
 return <section className="review-toolbar"><div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
 <button className="btn" aria-pressed={inbox} onClick={()=>{setInbox(!inbox);setSelection(new Set())}}>{inbox?'✓ ':''}Unreviewed inbox ({unreviewed})</button><button className="btn btn-p" onClick={onWeekly}>Start weekly review</button><span className="queue-progress">{trades.length-unreviewed} of {trades.length} reviewed</span></div>
 <details style={{marginTop:12}}><summary>Saved views</summary><div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}><input className="inp" aria-label="Name this view" placeholder="Name this view" maxLength={60} value={name} onChange={e=>setName(e.target.value)}/><button className="btn" disabled={!name.trim()||savedViews.length>=20} onClick={()=>{onSaveViews([...savedViews,{name:name.trim(),filters}]);setName('')}}>Save current view</button>{savedViews.map((v,i)=><span key={i}><button className="btn" onClick={()=>onApply(v.filters)}>{v.name}</button><button className="btn" aria-label={`Remove saved view ${v.name}`} onClick={()=>onSaveViews(savedViews.filter((_,n)=>n!==i))}>×</button></span>)}</div><p style={{color:'var(--mu)'}}>Views are stored on this browser and included in full backups with preferences.</p></details>
 <div className="selection-tools"><button className="text-button" disabled={busy} onClick={()=>setSelection(new Set(pageTrades.map(t=>t.id)))}>Select this page</button></div>
 {selection.size>0&&<div className="bulk-toolbar"><button className="btn btn-sm" onClick={()=>setSelection(new Set())}>Clear selection</button><span>{selection.size} selected</span><button className="btn btn-p btn-sm" disabled={preview||busy||!selection.size} onClick={()=>!preview&&bulk()}>Mark reviewed</button><select className="inp" aria-label="Bulk tag" value={tag} onChange={e=>setTag(e.target.value)}><option value="">Choose tag</option>{tags.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select><button className="btn btn-sm" disabled={preview||busy||!selection.size||!tag} onClick={()=>bulk(Number(tag))}>Add tag</button><button className="btn btn-sm" disabled={preview||busy||!selection.size||!tag} onClick={()=>bulk(Number(tag),true)}>Remove tag</button></div>}
 {busy&&<p role="status">Saving all selected trades together…</p>}{error&&<p role="alert" style={{color:'var(--ls)'}}>{error}</p>}
 <p className="review-guidance">Inspect the executions. Record one lesson. Mark reviewed.</p></section>
}
