import dynamic from 'next/dynamic'
import {useEffect,useState} from 'react'
import {chartPeriod,chartReference,fullChartUrl} from '../lib/marketChart'
import {defaultHistoryInterval,HISTORY_INTERVALS} from '../lib/marketHistory'
import {journalFetch} from '../lib/request'

const HistoricalReplayChart=dynamic(()=>import('./HistoricalReplayChart'),{ssr:false,loading:()=> <div className="market-chart-skeleton" role="status">Preparing historical chart…</div>})
const INTERVAL_LABEL={'1m':'1 minute','5m':'5 minutes','15m':'15 minutes','30m':'30 minutes','1h':'1 hour','4h':'4 hours','1d':'1 day'}

function previewHistory(trade){
 const end=Math.floor(Date.parse(trade.exit_time)/1000),start=Math.floor(Date.parse(trade.entry_time)/1000),base=Number(trade.entry_price)||100,count=80,step=Math.max(300,Math.floor((end-start+7200)/(count-20))),candles=[]
 for(let index=0;index<count;index++){const time=start-step*20+step*index,wave=Math.sin(index/5)*base*.004,drift=(index-20)*base*.00008,open=base+wave+drift,close=open+Math.sin(index*1.7)*base*.0015;candles.push({time,open,high:Math.max(open,close)+base*.0018,low:Math.min(open,close)-base*.0018,close,volume:0})}
 return {candles,interval:'5m',source:{kind:'sample',symbol:trade.symbol,label:'Representative sample history'},trade,markers:[{time:Date.parse(trade.entry_time),price:Number(trade.entry_price),side:trade.direction==='Long'?'Buy':'Sell',source:'sample entry'},{time:Date.parse(trade.exit_time),price:Number(trade.exit_price),side:trade.direction==='Long'?'Sell':'Buy',source:'sample exit'}],executionCoverage:'sample'}
}

export default function MarketChart({trade,active,preview=false}){
 const [started,setStarted]=useState(false),[dark,setDark]=useState(false),[interval,setIntervalValue]=useState(()=>defaultHistoryInterval(trade)),[history,setHistory]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0)
 const reference=chartReference(trade),external=reference.symbol||reference.savedSymbol
 useEffect(()=>{if(active)setStarted(true)},[active])
 useEffect(()=>{const sync=()=>setDark(document.body.classList.contains('dark-mode'));sync();const observer=new MutationObserver(sync);observer.observe(document.body,{attributes:true,attributeFilter:['class']});return()=>observer.disconnect()},[])
 useEffect(()=>{setIntervalValue(defaultHistoryInterval(trade));setHistory(null);setError('')},[trade.id])
 useEffect(()=>{
  if(!started)return
  if(preview){setHistory(previewHistory(trade));return}
  const controller=new AbortController();setLoading(true);setError('')
  journalFetch(`/api/market-history?tradeId=${encodeURIComponent(trade.id)}&interval=${encodeURIComponent(interval)}`,{signal:controller.signal})
   .then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error||'Historical chart data could not be loaded.');return body.history})
   .then(value=>{if(!controller.signal.aborted)setHistory(value)}).catch(reason=>{if(!controller.signal.aborted)setError(reason.message||'Historical chart data could not be loaded.')}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  return()=>controller.abort()
 },[started,trade.id,interval,retry,preview])
 return <section className="market-chart" hidden={!active} aria-label="Historical market replay">
  <div className="section-heading"><div><h2>Historical trade replay</h2><p>{history?.source?.label||'Loading the market period around this position.'}</p></div><div className="market-chart-actions"><label>Interval<select className="inp" value={interval} onChange={event=>setIntervalValue(event.target.value)}>{HISTORY_INTERVALS.map(value=><option key={value} value={value}>{INTERVAL_LABEL[value]}</option>)}</select></label><a className="btn" href={fullChartUrl(external)} target="_blank" rel="noopener noreferrer">Open on TradingView ↗</a></div></div>
  <div className="chart-reference-facts"><span>Trade product <strong>{trade.original_symbol||trade.symbol}</strong></span><span>Historical feed <strong>{history?.source?.symbol||'Resolving…'}</strong></span><span>Coverage <strong>{history?.executionCoverage==='complete'?'Imported fills':history?.executionCoverage==='summary_only'?'Average entry / exit':'Available source history'}</strong></span></div>
  <dl className="chart-trade-period"><div><dt>Trade opened</dt><dd>{chartPeriod(trade.entry_time)}</dd></div><div><dt>Trade closed</dt><dd>{chartPeriod(trade.exit_time)}</dd></div></dl>
  {preview&&<p className="preview-inline">Representative chart data · the signed-in journal loads the actual historical feed and imported executions.</p>}
  {loading?<div className="market-chart-skeleton" role="status"><strong>Loading historical candles…</strong><span>Positioning the chart around the trade and matching execution times.</span></div>:error?<div className="chart-fallback" role="alert"><h3>Historical chart unavailable</h3><p>{error}</p><button className="btn btn-p" onClick={()=>setRetry(value=>value+1)}>Retry</button>{external&&<a className="btn" href={fullChartUrl(external)} target="_blank" rel="noopener noreferrer">Open reference chart ↗</a>}</div>:history?<HistoricalReplayChart key={`${trade.id}-${history.interval}-${dark}`} history={history} dark={dark}/>:null}
  <p className="chart-disclosure">The chart opens at the trade’s historical period. Markers use imported fills when available; otherwise they show the saved average entry and exit. Reference futures, spot, CFD or perpetual prices can differ from your broker executions.</p>
  <p className="chart-credit">Historical data: {history?.source?.kind==='hyperliquid'?<a href="https://hyperliquid.xyz" target="_blank" rel="noopener noreferrer">Hyperliquid</a>:history?.source?.kind==='yahoo'?<a href="https://finance.yahoo.com" target="_blank" rel="noopener noreferrer">Yahoo Finance reference feed</a>:'representative preview'}. Chart rendering uses <a href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noopener noreferrer">TradingView Lightweight Charts</a>.</p>
 </section>
}
