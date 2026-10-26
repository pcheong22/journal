import { useState } from 'react'

const WALLETS = [
  '0x2A8F7F1682B629b16f5309182DA8920dAF72D0F9',
  '0x950793403DFaA533c7ef84E81272bf94f5b46466',
]

export default function TxFlowAccountModal({ filename, defaultTimezone, existingAccounts, onSelect, onClose }) {
  const [wallet, setWallet] = useState('')
  const [timezone, setTimezone] = useState(defaultTimezone)
  const [custom, setCustom] = useState(false)
  const known = [...new Set([...WALLETS, ...existingAccounts.map(account => account.id.replace(/^TXFLOW_/, ''))]
    .map(address => address.toLowerCase()))]
  const valid = /^0x[\da-f]{40}$/i.test(wallet)
  return (
    <div className="mo" onClick={event => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="txflow-account-title"
        style={{background:'var(--sf)',border:'1px solid var(--bd)',borderRadius:10,padding:24,width:460,maxWidth:'95vw',boxShadow:'var(--sh-lg)',margin:'auto'}}>
        <div id="txflow-account-title" style={{fontWeight:700,fontSize:14,marginBottom:4}}>Which TxFlow account?</div>
        <div style={{fontSize:11,color:'var(--mu)',marginBottom:16,overflowWrap:'anywhere'}}>{filename}</div>
        <div style={{display:'grid',gap:8,marginBottom:14}}>
          {known.map(address => (
            <button key={address} aria-pressed={!custom && wallet === address} onClick={() => { setCustom(false); setWallet(address) }}
              style={{padding:'10px 14px',border:`1px solid ${!custom && wallet === address ? 'var(--ac)' : 'var(--bd)'}`,borderRadius:7,background:'var(--sf2)',cursor:'pointer',textAlign:'left'}}>
              <div style={{fontWeight:600,fontSize:12,color:'var(--tx)',marginBottom:2}}>TxFlow {address.slice(0,6)}....{address.slice(-4).toUpperCase()}</div>
              <div style={{fontSize:10,color:'var(--mu)',fontFamily:'var(--font-mono)',overflowWrap:'anywhere'}}>{address}</div>
            </button>
          ))}
        </div>
        {!custom ? <button className="btn btn-sm" onClick={() => { setCustom(true); setWallet('') }}>+ Add a different account</button> :
          <input className="inp" aria-label="TxFlow wallet address" placeholder="0x..." value={wallet} onChange={event => setWallet(event.target.value.trim())} autoFocus />}
        <label style={{display:'block',fontSize:11,color:'var(--mu)',marginTop:16,marginBottom:6}}>CSV timezone
          <select className="inp" value={timezone} onChange={event => setTimezone(event.target.value)} style={{display:'block',marginTop:6,width:'100%'}}>
            {[...new Set([defaultTimezone, 'Asia/Dubai', 'UTC', 'Europe/London', 'America/New_York', 'Asia/Singapore'])].map(zone => <option key={zone} value={zone}>{zone}</option>)}
          </select>
        </label>
        <div style={{fontSize:10,color:'var(--mu)',marginTop:6}}>Select the timezone shown in your exported timestamps.</div>
        <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:20}}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-p" disabled={!valid} onClick={() => onSelect(wallet, timezone)}>Confirm and import</button>
        </div>
      </div>
    </div>
  )
}
