export default function UploadModal({ file, accounts, onClose, onUpload }) {
  const [selectedId, setSelectedId] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [loading, setLoading] = useState(false)

  const handleUpload = async () => {
    if(!selectedId) return
    setLoading(true)
    let finalId = selectedId
    if(selectedId === 'new') {
      // Create account first
      const res = await fetch('/api/accounts', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ broker:'Generic', label:newLabel.trim()||file.name.replace(/\.csv$/i,''), currency:'USD' })
      })
      const data = await res.json()
      if(data.success) finalId = data.accountId
    }
    await onUpload(finalId)
    setLoading(false)
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(12,17,23,0.92)',backdropFilter:'blur(6px)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{background:'#161b22',border:'1px solid #30363d',borderRadius:10,width:'100%',maxWidth:460,boxShadow:'0 8px 30px rgba(0,0,0,0.5)'}}>
        <div style={{padding:16,borderBottom:'1px solid #30363d',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontWeight:700,fontSize:14}}>📂 Assign Upload to Account</div>
          <button onClick={onClose} style={{background:'transparent',border:'1px solid #30363d',color:'#e6edf3',padding:'4px 8px',borderRadius:4,cursor:'pointer',fontSize:11}}>✕</button>
        </div>
        <div style={{padding:20}}>
          <div style={{fontSize:11,color:'#8b949e',marginBottom:12,fontFamily:'monospace',wordBreak:'break-all'}}>File: <strong style={{color:'#e6edf3'}}>{file?.name}</strong></div>
          <label style={{display:'block',fontSize:11,fontWeight:600,color:'#8b949e',marginBottom:6,textTransform:'uppercase',letterSpacing:0.06}}>Assign to Account</label>
          <select value={selectedId} onChange={e=>setSelectedId(e.target.value)} style={{width:'100%',padding:10,background:'#0c1117',border:'1px solid #30363d',color:'#e6edf3',borderRadius:6,fontSize:13,marginBottom:16}}>
            <option value="">-- Select Account --</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.label||a.id} ({a.broker})</option>)}
            <option value="new">+ Create New Account...</option>
          </select>
          {selectedId === 'new' && (
            <input type="text" placeholder="e.g., Hyperliquid Main" value={newLabel} onChange={e=>setNewLabel(e.target.value)} style={{width:'100%',padding:10,background:'#0c1117',border:'1px solid #30363d',color:'#e6edf3',borderRadius:6,fontSize:13,marginBottom:16}} />
          )}
          <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
            <button onClick={onClose} style={{background:'transparent',border:'1px solid #30363d',color:'#e6edf3',padding:'6px 12px',borderRadius:6,cursor:'pointer',fontSize:12}}>Cancel</button>
            <button onClick={handleUpload} disabled={!selectedId||(selectedId==='new'&&!newLabel.trim())||loading} style={{background:'#4bde80',color:'#0c1117',border:'none',padding:'6px 12px',borderRadius:6,fontWeight:600,cursor:'pointer',fontSize:12,opacity:(!selectedId||(selectedId==='new'&&!newLabel.trim()))?0.5:1}}>{loading?'Processing...':'Upload & Import'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}