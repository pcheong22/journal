import { useState, useRef, useEffect } from 'react'
import { journalFetch } from '../lib/request'
import { BACKUP_LIMIT } from '../lib/backupFormat'
export default function BackupPanel({ settings }) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
  const [history,setHistory]=useState([]),[preview,setPreview]=useState(null),[confirmation,setConfirmation]=useState(''),[restoreSettings,setRestoreSettings]=useState(false)
  const fileRef=useRef()
  const request=async body=>(await journalFetch('/api/backup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json()
  const load=async()=>{try {setHistory((await (await journalFetch('/api/backup')).json()).backups || [])}catch(e){setError(e.message)}}
  useEffect(()=>{load()},[])
  const run=async action=>{setBusy(true);setError('');setMessage('');try{await action()}catch(e){setError(e.message)}finally{setBusy(false)}}
  const download=url=>{const link=document.createElement('a');link.href=url;link.rel='noreferrer';document.body.appendChild(link);link.click();link.remove()}
  const exportBackup=()=>run(async()=>{const data=await request({action:'export',settings});download(data.url);setMessage('Full backup saved and download started.');await load()})
  const inspect=async id=>{const data=await request({action:'preview',id});setPreview(data);setConfirmation('');setRestoreSettings(false)}
  const upload=file=>{if(!file)return;run(async()=>{
    if(file.size>BACKUP_LIMIT || !file.name.toLowerCase().endsWith('.json'))throw new Error('Choose a JSON backup under 50 MB.')
    const candidate=await request({action:'upload'})
    // Signed URL grants upload of this one new object; journal credentials stay on the server.
    const uploaded=await fetch(candidate.url,{method:'PUT',headers:{'Content-Type':'application/json','x-upsert':'false'},body:await file.arrayBuffer()})
    if(!uploaded.ok)throw new Error('Could not upload backup. Please retry.')
    await inspect(candidate.id)
  })}
  const restore=()=>run(async()=>{
    const data=await (await journalFetch('/api/backup',{method:'POST',headers:{'Content-Type':'application/json','X-Journal-Restore':confirmation},body:JSON.stringify({action:'restore',id:preview.id,digest:preview.digest,checksum:preview.checksum,settings})})).json()
    if(!data.restored)throw new Error('Restore was not confirmed. Please retry.')
    if(restoreSettings && preview.hasSettings && data.settings)localStorage.setItem('ti_settings',JSON.stringify(data.settings))
    window.location.reload()
  })
  return <section style={{padding:'16px 0',borderTop:'1px solid var(--bd)',marginTop:18}}>
    <h3 style={{fontSize:13,margin:'0 0 8px'}}>Backup & restore</h3>
    <p style={{fontSize:11,color:'var(--mu)',lineHeight:1.6}}>Full backups include every account, trade, note, tag, strategy, passed trade, report, screenshot and execution file. Sign-in credentials stay with Supabase. Limits: 20 MB of attached files and 50 MB per backup.</p>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <button className="btn btn-p btn-sm" disabled={busy} onClick={exportBackup}>Download full backup</button>
      <button className="btn btn-sm" disabled={busy} onClick={()=>fileRef.current?.click()}>Choose backup to restore</button>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e=>{upload(e.target.files?.[0]);e.target.value=''}} />
    </div>
    {busy && <p role="status" style={{fontSize:11}}>Working… keep this window open.</p>}
    {error && <p role="alert" style={{fontSize:11,color:'var(--ls)',lineHeight:1.6}}>{error}</p>}
    {message && <p role="status" style={{fontSize:11,color:'var(--wn)'}}>{message}</p>}
    {preview && <div style={{padding:12,marginTop:12,border:'1px solid var(--wa)',borderRadius:8}}>
      <strong style={{fontSize:12}}>Review restoration</strong>
      <p style={{fontSize:11,lineHeight:1.6}}>This replaces journal data with the backup from {new Date(preview.createdAt).toLocaleString()}. A full safety copy is saved first. Existing stored files are retained.</p>
      <table style={{width:'100%',fontSize:11}} aria-label="Restore preview counts"><thead><tr><th>Records</th><th>Now</th><th>Backup</th></tr></thead><tbody>{Object.keys(preview.counts).map(name=><tr key={name}><td>{name.replaceAll('_',' ')}</td><td>{preview.currentCounts[name]}</td><td>{preview.counts[name]}</td></tr>)}</tbody></table>
      <p style={{fontSize:11}}>{preview.files} attached files included.</p>
      <label style={{display:'flex',gap:6,fontSize:11,margin:'12px 0'}}><input type="checkbox" disabled={!preview.hasSettings} checked={restoreSettings} onChange={e=>setRestoreSettings(e.target.checked)}/>{preview.hasSettings ? 'Also restore browser preferences' : 'Browser preferences were not included in this automatic copy'}</label>
      <label style={{fontSize:11}} htmlFor="restore-confirm">Type RESTORE JOURNAL to confirm</label>
      <input id="restore-confirm" className="inp" value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)} style={{width:'100%',margin:'6px 0 10px',boxSizing:'border-box'}} />
      <div style={{display:'flex',gap:8}}><button className="btn btn-p btn-sm" disabled={busy || confirmation!=='RESTORE JOURNAL'} onClick={restore}>Restore backup</button><button className="btn btn-sm" disabled={busy} onClick={()=>setPreview(null)}>Cancel</button></div>
    </div>}
    {history.length>0 && <details style={{marginTop:14,fontSize:11}}><summary>Recent backups and safety copies</summary>{history.map(item=><div key={item.id} style={{borderBottom:'1px solid var(--bd)',padding:'10px 0'}}>
      <div>{new Date(item.created_at).toLocaleString()} · {item.counts?.trades ?? '—'} trades</div><div style={{color:'var(--mu)',marginTop:3}}>{item.reason}</div>
      <div style={{display:'flex',gap:8,marginTop:6}}><button className="btn btn-sm" disabled={busy} onClick={()=>run(async()=>download((await (await journalFetch('/api/backup?id='+item.id)).json()).url))}>Download</button><button className="btn btn-sm" disabled={busy} onClick={()=>run(()=>inspect(item.id))}>Review restore</button></div>
    </div>)}</details>}
  </section>
}
