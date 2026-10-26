import {useEffect,useRef} from 'react'
import {Chart} from 'chart.js'
import {money} from '../lib/presentation'
export default function LedgerEquity({data=[],privacy=false}){
 const equity=useRef(),underwater=useRef()
 useEffect(()=>{
  if(!data.length)return
  const style=getComputedStyle(document.body),color=style.getPropertyValue('--tx2').trim(),grid=style.getPropertyValue('--bd').trim(),accent=style.getPropertyValue('--ac').trim(),loss=style.getPropertyValue('--ls').trim()
  let peak=0;const dd=data.map(d=>{peak=Math.max(peak,d.cum_pnl);return d.cum_pnl-peak}),labels=data.map(d=>d.date)
  const tick=v=>privacy?'•••':money(v,{compact:true,signed:false})
  const base={responsive:true,maintainAspectRatio:false,animation:false,interaction:{intersect:false,mode:'index'},plugins:{legend:{display:false},tooltip:{backgroundColor:style.getPropertyValue('--sf').trim(),titleColor:color,bodyColor:color,borderColor:grid,borderWidth:1,callbacks:{label:c=>privacy?'Amount hidden':money(c.parsed.y)}}},scales:{x:{grid:{display:false},border:{display:false},ticks:{color,maxTicksLimit:6,maxRotation:0,callback:(_,i)=>new Date(labels[i]+'T00:00:00Z').toLocaleDateString('en-GB',{month:'short',year:'2-digit',timeZone:'UTC'})}},y:{afterFit:s=>{s.width=76},border:{display:false},grid:{color},ticks:{color,callback:tick,maxTicksLimit:4},beginAtZero:true}}}
  base.scales.y.grid.color=grid
  const a=new Chart(equity.current,{type:'line',data:{labels,datasets:[{label:'Realised P&L',data:data.map(d=>d.cum_pnl),borderColor:accent,backgroundColor:accent+'0d',fill:true,pointRadius:0,borderWidth:2,tension:0}]},options:{...base,scales:{...base.scales,x:{...base.scales.x,ticks:{display:false}}}}})
  const b=new Chart(underwater.current,{type:'line',data:{labels,datasets:[{label:'Closed-trade drawdown',data:dd,borderColor:loss,backgroundColor:loss+'1a',fill:true,pointRadius:0,borderWidth:1,tension:0}]},options:{...base,scales:{...base.scales,y:{...base.scales.y,max:0,ticks:{...base.scales.y.ticks,maxTicksLimit:2}}}}})
  return()=>{a.destroy();b.destroy()}
 },[data,privacy])
 return <div className="ledger-equity"><div className="section-heading"><div><h2>Cumulative realised P&amp;L</h2><p>Closed-trade results across the selected period</p></div><span className="chart-key"><i/>Realised P&amp;L</span></div><div className="equity-canvas"><canvas ref={equity} role="img" aria-label={privacy?'Cumulative realised P&L; amounts hidden':`Cumulative realised P&L ends at ${money(data.at(-1)?.cum_pnl)}`}/></div><div className="drawdown-heading">Drawdown from realised peak <span>Open positions and cash flows excluded</span></div><div className="drawdown-canvas"><canvas ref={underwater} role="img" aria-label="Closed-trade drawdown aligned with the cumulative P&L timeline"/></div></div>
}
