import dynamic from 'next/dynamic'
import {useState} from 'react'
import {priceCheck} from '../lib/symbols'
import {money,instrumentContributions} from '../lib/presentation'
import DataQuality from './DataQuality'
const ChartComp=dynamic(()=>import('./Charts'),{ssr:false})
function Metric({label,value,context,tone='',privateValue=false}){return <div className="headline-metric"><div className="metric-label">{label}</div><div className={'metric-value '+tone+(privateValue?' private':'')}>{value}</div><div className="metric-context">{context}</div></div>}
export default function JournalOverview({stats,trades,tags,privacy,onReview,onInstrument,onSourceCheck}){
 const [ascending,setAscending]=useState(false),[all,setAll]=useState(false)
 const o=stats.overview,reviewed=tags.find(t=>t.name==='Reviewed')?.id,remaining=trades.filter(t=>!t.tag_ids?.includes(reviewed)).length,checks=trades.filter(t=>priceCheck(t)).length
 let rows=instrumentContributions(trades);if(ascending)rows.reverse();const visible=all?rows:rows.slice(0,8)
 return <div className="ledger-overview"><div className="page-heading"><div><span className="eyebrow">Performance journal</span><h1>Overview</h1><p>Understand the outcome. Review the decisions.</p></div><button className="btn" onClick={onReview}>Review trades <span aria-hidden="true">↗</span></button></div>
  <section className="headline-strip" aria-label="Performance summary"><Metric label="Reported realised P&L" value={money(o.total_pnl)} context="Closed trades · broker-reported basis" tone={o.total_pnl>=0?'positive':'negative'} privateValue/>
   <Metric label="Win rate" value={(o.win_rate*100).toFixed(1)+'%'} context={`${o.winning_count.toLocaleString()} wins · ${o.losing_count.toLocaleString()} losses`}/>
   <Metric label="Profit factor" value={o.profit_factor==null?'—':o.profit_factor.toFixed(2)+'×'} context={<span className="private">{money(o.avg_win,{signed:false})} avg win / {money(Math.abs(o.avg_loss),{signed:false})} avg loss</span>}/>
   <Metric label="Closed-trade drawdown" value={money(-o.max_drawdown)} context="Largest decline from a realised P&L peak" privateValue/>
   <Metric label="Average P&L per trade" value={money(o.total_pnl/o.total_trades)} context={`${o.total_trades.toLocaleString()} closes · ${o.breakeven_count} breakeven`} privateValue/>
  </section>
  <section className="hero-section"><ChartComp type="ledgerEquity" data={stats.cumulative} privacy={privacy}/></section>
  <div className="overview-payoff"><ChartComp type="monthly" data={stats.monthly} privacy={privacy}/><ChartComp type="distribution" trades={trades} privacy={privacy}/></div>
  <section className="contribution-section"><div className="section-heading"><div><h2>Instrument contribution</h2><p>Reported P&L by market · products remain distinct</p></div><button className="text-button" onClick={()=>setAscending(!ascending)}>{ascending?'Largest losses first':'Largest gains first'} ↓</button></div>
   <table className="contribution-table"><thead><tr><th>Instrument</th><th className="numeric">Trades</th><th>Contribution</th><th className="numeric">Reported P&L</th></tr></thead><tbody>{visible.map(r=><tr key={r.symbol}><td><button className="instrument-link" onClick={()=>onInstrument(r.symbol)}>{r.symbol}</button></td><td className="numeric">{r.count}</td><td><div className="contribution-track"><span style={{width:`${r.width}%`,background:r.pnl>=0?'var(--wn)':'var(--ls)'}}/></div></td><td className={'numeric private '+(r.pnl>=0?'positive':'negative')}>{money(r.pnl)}</td></tr>)}</tbody></table><button className="text-button" onClick={()=>setAll(!all)}>{all?'Show fewer instruments':`View all ${rows.length} instruments`}</button>
  </section>
  <section className="secondary-facts"><div><span>Long positions</span><strong className="private">{money(o.long_pnl)}</strong><small>{o.long_count} trades · {(o.long_wr*100).toFixed(1)}% win rate</small></div><div><span>Short positions</span><strong className="private">{money(o.short_pnl)}</strong><small>{o.short_count} trades · {(o.short_wr*100).toFixed(1)}% win rate</small></div><div><span>Review queue</span><strong>{remaining.toLocaleString()}</strong><small>Unreviewed in this period</small></div></section>
  <div className="review-callout"><div><h2>Make the next trade more deliberate.</h2><p>{remaining.toLocaleString()} trades await review in this scope. Record one lesson, then mark each reviewed.</p></div><button className="btn btn-p" onClick={onReview}>Open review queue →</button></div>
  {checks>0&&<div className="data-check-notice" role="status"><strong>{checks} trades need a source check.</strong> The price move and reported outcome have opposite signs; fees, funding or inferred matching may explain it. Price-derived figures are withheld while reported P&L is preserved. <button className="text-button" onClick={onSourceCheck}>Review source checks →</button></div>}
  <DataQuality trades={trades}/>
 </div>
}
