import {useEffect,useState} from 'react'
import {chartReference,chartUrl,fullChartUrl,initialChartInterval,chartPeriod,validChartSymbol} from '../lib/marketChart'

export default function MarketChart({trade,active,preview=false}){
 const [started,setStarted]=useState(false),[dark,setDark]=useState(false),[override,setOverride]=useState(''),[candidate,setCandidate]=useState(''),[inputError,setInputError]=useState(''),[status,setStatus]=useState('loading'),[attempt,setAttempt]=useState(0)
 const reference=chartReference(trade,override),symbol=reference.symbol
 const src=chartUrl(symbol,dark,initialChartInterval(trade))
 useEffect(()=>{if(active)setStarted(true)},[active])
 useEffect(()=>{
  const sync=()=>setDark(document.body.classList.contains('dark-mode'));sync()
  const observer=new MutationObserver(sync);observer.observe(document.body,{attributes:true,attributeFilter:['class']})
  return()=>observer.disconnect()
 },[])
 useEffect(()=>{
  if(!started||preview||!src)return
  setStatus('loading')
  const timer=setTimeout(()=>setStatus(current=>current==='loading'?'slow':current),15000)
  return()=>clearTimeout(timer)
 },[started,src,preview,attempt])
 const retry=()=>{setStatus('loading');setAttempt(n=>n+1)}
 const unavailable=status==='unavailable'
 return <section className="market-chart" hidden={!active} aria-label="Market reference chart">
  <div className="section-heading"><div><h2>Market reference</h2><p>{symbol?reference.label:'No reference feed has been mapped for this instrument.'}</p></div><a className="btn" href={fullChartUrl(symbol||reference.savedSymbol)} target="_blank" rel="noopener noreferrer">Open on TradingView ↗</a></div>
  <div className="chart-reference-facts"><span>Trade product <strong>{trade.original_symbol||trade.symbol}</strong></span><span>Chart feed <strong>{symbol||'Not mapped'}</strong></span>{reference.savedSymbol!==symbol&&<span>Saved chart ticker <a href={fullChartUrl(reference.savedSymbol)} target="_blank" rel="noopener noreferrer">{reference.savedSymbol} ↗</a></span>}</div>
  <p className="chart-disclosure">Shows recent market data, without your execution markers. Use chart controls to find the trade period. Reference prices, contracts and currency may differ from {trade.broker||'your broker'} executions.</p>
  <dl className="chart-trade-period"><div><dt>Trade opened</dt><dd>{chartPeriod(trade.entry_time)}</dd></div><div><dt>Trade closed</dt><dd>{chartPeriod(trade.exit_time)}</dd></div></dl>
  {preview?<p className="data-check-notice">External charts are disabled in this sample preview.</p>:!symbol||unavailable?<div className="chart-fallback" role="status"><h3>{symbol?'Chart unavailable here':'Choose a reference feed'}</h3><p>TradingView may restrict a symbol in embedded charts even when it works on its website. Open the chart above, try another qualified feed below, or attach a chart screenshot to this trade.</p>{symbol&&<button className="btn" onClick={retry}>Retry chart</button>}</div>:<>
   <div className="chart-load-status" role="status">{status==='loading'?'Opening TradingView…':status==='slow'?'TradingView is taking longer than expected. You can retry or open it directly.':'TradingView frame opened. Blank chart or symbol error? Use the recovery options below.'}</div>
   <div className="market-chart-frame" aria-busy={status==='loading'}>{started&&<iframe key={attempt} src={src} title={`${reference.market} reference chart on TradingView`} onLoad={()=>setStatus('opened')} onError={()=>setStatus('unavailable')} referrerPolicy="strict-origin-when-cross-origin" allowFullScreen/>}</div>
   <div className="chart-recovery"><button className="text-button" onClick={()=>setStatus('unavailable')}>Chart not working?</button><button className="text-button" onClick={retry}>Reload chart</button></div>
  </>}
  <details className="chart-feed-picker"><summary>Use another reference feed</summary><form onSubmit={event=>{event.preventDefault();const value=candidate.trim().toUpperCase();if(!validChartSymbol(value)){setInputError('Use an exchange-qualified symbol, such as OANDA:WTICOUSD.');return}setInputError('');setOverride(value);retry()}}><label>TradingView feed<input className="inp" aria-invalid={!!inputError} aria-describedby={inputError?'chart-feed-error':undefined} value={candidate} onChange={event=>setCandidate(event.target.value)} placeholder="EXCHANGE:SYMBOL" maxLength={80}/></label><button className="btn" type="submit">Use feed</button>{override&&<button className="btn" type="button" onClick={()=>{setOverride('');setCandidate('');setInputError('');retry()}}>Use default feed</button>}</form>{inputError&&<p id="chart-feed-error" role="alert">{inputError}</p>}<p>This changes this open chart only. Your saved trade, contract and analytics are unchanged.</p></details>
  <p className="chart-credit">Chart and market data by <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView</a>. Availability and delay depend on the selected feed.</p>
 </section>
}
