import { useState, useEffect } from 'react'

const PRESETS = ['1D','1W','MTD','1M','QTD','3M','YTD','1Y','All','Custom']

export default function DateRangeFilter({ onRangeChange, defaultValue='MTD' }) {
  const [active, setActive] = useState(defaultValue)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [showCustom, setShowCustom] = useState(false)

  const getRange = (range, startStr, endStr) => {
    const now = new Date()
    const startOfDay = d => { d.setUTCHours(0,0,0,0); return d }
    const endOfDay = d => { d.setUTCHours(23,59,59,999); return d }
    let start = new Date(0), end = endOfDay(new Date(now))

    switch(range) {
      case '1D': start = startOfDay(new Date(now)); break
      case '1W': start = startOfDay(new Date(now.getTime() - 6*86400000)); break
      case 'MTD': start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); break
      case '1M': start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()-1, now.getUTCDate())); break
      case 'QTD': start = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth()/3)*3, 1)); break
      case '3M': start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()-3, now.getUTCDate())); break
      case 'YTD': start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)); break
      case '1Y': start = new Date(Date.UTC(now.getUTCFullYear()-1, now.getUTCMonth(), now.getUTCDate())); break
      case 'Custom': if(startStr && endStr) { start = startOfDay(new Date(startStr)); end = endOfDay(new Date(endStr)); } break
      default: start = new Date(0)
    }
    return { start, end, label: range === 'Custom' ? `${startStr} → ${endStr}` : range }
  }

  useEffect(() => {
    onRangeChange?.(getRange(active, customStart, customEnd))
  }, [active, customStart, customEnd])

  const handlePreset = (val) => {
    setActive(val)
    setShowCustom(val === 'Custom')
    if(val !== 'Custom') { setCustomStart(''); setCustomEnd('') }
  }

  return (
    <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:4,marginBottom:16}}>
      {PRESETS.map(p => (
        <button key={p} onClick={()=>handlePreset(p)} style={{
          padding:'4px 8px',borderRadius:4,border:'1px solid',
          background: active===p ? '#4bde80' : 'transparent',
          borderColor: active===p ? '#4bde80' : '#30363d',
          color: active===p ? '#0c1117' : '#8b949e',
          fontSize:11,fontWeight:600,cursor:'pointer',transition:'.15s'
        }}>{p}</button>
      ))}
      {showCustom && (
        <div style={{display:'flex',alignItems:'center',gap:4,marginLeft:4}}>
          <input type="date" value={customStart} onChange={e=>setCustomStart(e.target.value)} style={{background:'#161b22',border:'1px solid #30363d',color:'#e6edf3',padding:3,borderRadius:4,fontSize:11}} />
          <span style={{color:'#8b949e',fontSize:11}}>→</span>
          <input type="date" value={customEnd} onChange={e=>setCustomEnd(e.target.value)} style={{background:'#161b22',border:'1px solid #30363d',color:'#e6edf3',padding:3,borderRadius:4,fontSize:11}} />
          <button onClick={()=>{if(customStart&&customEnd){setShowCustom(false);setActive('Custom')}}} disabled={!customStart||!customEnd} style={{background:'#4bde80',color:'#0c1117',border:'none',padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:600,cursor:'pointer'}}>Apply</button>
        </div>
      )}
    </div>
  )
}