import {useEffect,useState} from 'react'
import {journalFetch} from '../lib/request'
import {importRequest} from './ImportReview'
export default function ImportHistory(){
 const [rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const load=async()=>setRows((await(await journalFetch('/api/imports')).json()).imports || [])
 useEffect(()=>{load().catch(e=>setError(e.message))},[])
 const run=async fn=>{setBusy(true);setError('');try{await fn();await load()}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <section style={{marginTop:24,borderTop:'1px solid var(--bd)',paddingTop:16}}><h3>Import history</h3><p style={{fontSize:11,color:'var(--mu)'}}>Original exports are kept privately as compressed files. Each import that changes trades has a full safety copy in Backup &amp; restore. Restoring that copy replaces the whole journal, including later edits; review its preview first.</p>{error&&<p role="alert">{error}</p>}<details><summary>Recent uploads ({rows.length})</summary>{rows.map(row=><div key={row.id} style={{padding:'12px 0',borderBottom:'1px solid var(--bd)',fontSize:11}}><strong>{row.filename}</strong><p>{row.broker} · {row.account_id} · {row.status} · {new Date(row.created_at).toLocaleString()}</p>{row.counts&&<p>{Object.entries(row.counts).map(([key,value])=>`${value} ${key}`).join(' · ')}</p>}<button className="btn btn-sm" disabled={busy} onClick={()=>run(async()=>{const {url}=await(await journalFetch('/api/imports?id='+row.id)).json();window.location.assign(url)})}>Download original (.gz)</button>{row.details_status==='failed'&&<button className="btn btn-sm" disabled={busy} onClick={()=>run(async()=>{const result=await importRequest({action:'retry_details',id:row.id});if(result.warning)throw new Error(result.warning)})}>Retry execution details</button>}{row.safety_backup&&<p>Safety copy: {row.safety_backup}</p>}</div>)}</details></section>
}
