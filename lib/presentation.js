export function money(value,{compact=false,signed=true}={}){
 if(!Number.isFinite(value))return '—'
 const sign=value<0?'−':signed&&value>0?'+':''
 const magnitude=Math.abs(value)
 return sign+'$'+(compact&&magnitude>=1e6?(magnitude/1e6).toFixed(1)+'m':compact&&magnitude>=1e3?(magnitude/1e3).toFixed(magnitude>=1e5?0:1)+'k':magnitude.toLocaleString('en-US',{maximumFractionDigits:0}))
}
export function durationLabel(minutes){if(minutes==null||!Number.isFinite(minutes))return 'Unknown';if(minutes<60)return `${Math.round(minutes)}m`;const h=Math.floor(minutes/60),m=Math.round(minutes%60);return `${h}h${m?' '+m+'m':''}`}
export function instrumentContributions(trades){const groups=new Map();for(const t of trades){const g=groups.get(t.symbol)||{symbol:t.symbol,count:0,pnl:0};g.count++;g.pnl+=t.pnl||0;groups.set(t.symbol,g)}const rows=[...groups.values()].sort((a,b)=>b.pnl-a.pnl);const max=Math.max(1,...rows.map(r=>Math.abs(r.pnl)));return rows.map(r=>({...r,width:Math.abs(r.pnl)/max*100}))}
