import {useState} from 'react'
import {journalFetch} from '../lib/request'
export const importRequest=async body=>(await journalFetch('/api/imports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json()
export default function ImportReview({preview,onClose,onComplete}){
 const [data,setData]=useState(preview),[account,setAccount]=useState(preview.accountId || ''),[reviewed,setReviewed]=useState(false),[correct,setCorrect]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const run=async fn=>{setBusy(true);setError('');try{await fn()}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <div className="mo" role="dialog" aria-modal="true" aria-labelledby="import-title"><div className="modal" style={{maxWidth:900,width:'95vw',maxHeight:'90vh',overflow:'auto',padding:24,background:'var(--sf)',border:'1px solid var(--bd)',borderRadius:10,margin:'auto'}}>
  <h2 id="import-title">Review import · {data.broker}</h2>
  <p>No trades change until you confirm this preview.</p>
  {data.needsAccount?<><label>Account ID <input className="inp" value={account} onChange={e=>setAccount(e.target.value)} list="import-accounts" /></label><datalist id="import-accounts">{data.accounts.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}</datalist><button className="btn" disabled={busy||!account.trim()} onClick={()=>run(async()=>setData(await importRequest({action:'preview',id:data.id,accountId:account.trim(),timezone:preview.requestTimezone})))}>Preview account</button></>:<>
   <p><strong>{data.accountId}</strong> · {data.currency} · timestamps: {data.timezone}</p>
   {data.sourceAccountId&&data.sourceAccountId!==data.accountId&&<p>Source account: {data.sourceAccountId}. Matched to the existing journal account above.</p>}
   <div style={{display:'flex',gap:20,flexWrap:'wrap',margin:'18px 0'}}>{Object.entries(data.counts).map(([key,value])=><div key={key}><strong style={{fontSize:24}}>{value}</strong><br/>{key}</div>)}</div>
   {data.audit?.available&&<><h3>Export P&amp;L check</h3><p>Eligible rows in this file only; this is not an account statement reconciliation. Fees follow the broker export.</p><table style={{width:'100%'}}><thead><tr><th>Currency</th><th>Export</th><th>Parsed</th><th>Difference</th></tr></thead><tbody>{data.audit.totals?.map(t=><tr key={t.currency}><td>{t.currency}</td><td>{Number(t.source).toFixed(2)}</td><td>{Number(t.parsed).toFixed(2)}</td><td>{Number(t.difference).toFixed(2)}</td></tr>)}</tbody></table></>}
   {data.warnings?.length>0&&<ul style={{lineHeight:1.7}}>{data.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>}
   {data.currencyMismatch&&<label style={{display:'block',margin:'14px 0'}}><input type="checkbox" checked={correct} onChange={e=>setCorrect(e.target.checked)}/> Correct this account's currency to match the export <button className="btn btn-sm" disabled={!correct||busy} onClick={()=>run(async()=>{setData(await importRequest({action:'preview',id:data.id,accountId:data.accountId,timezone:preview.requestTimezone,correctCurrency:true}));setReviewed(false)})}>Refresh preview</button></label>}
   <details><summary>Inspect proposed trades ({data.rows?.length || 0})</summary><div style={{overflow:'auto',maxHeight:300}}><table style={{width:'100%'}}><thead><tr><th>Status</th><th>Instrument</th><th>Changes / reason</th></tr></thead><tbody>{data.rows?.map((r,i)=><tr key={i}><td>{r.status}</td><td>{r.symbol}</td><td>{r.reason || r.changes?.map(c=>`${c.field}: ${c.before??'—'} → ${c.after??'—'}`).join('; ') || `${r.pnl} ${r.currency}`}</td></tr>)}</tbody></table></div></details>
   {data.needsReview&&<label style={{display:'block',margin:'18px 0'}}><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/> I have reviewed the changes, source assumptions and warnings.</label>}
  </>}
  {error&&<p role="alert" style={{color:'var(--ls)'}}>{error}</p>}
  <div style={{display:'flex',gap:12,marginTop:20}}><button className="btn" disabled={busy} onClick={onClose}>Cancel</button>{!data.needsAccount&&<button className="btn btn-p" disabled={busy||data.counts.blocked>0||data.needsReview&&!reviewed} onClick={()=>run(async()=>onComplete(await importRequest({action:'commit',id:data.id,reviewed})))}>{busy?'Saving safely…':'Confirm import'}</button>}</div>
 </div></div>
}
