import {useEffect,useMemo,useRef,useState} from 'react'

const price=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:8})
const priceScale=candles=>{const sample=candles.find(candle=>Number(candle.close)>0)?.close||1,precision=sample>=100?2:sample>=10?3:sample>=1?4:sample>=.01?6:8;return {type:'price',precision,minMove:10**-precision}}
const PIVOT_COLORS={Weekly:'#5c8ea3',Monthly:'#8a6ca8',Quarterly:'#c28b3c',Yearly:'#c85f5f'}

export function chartMarkers(candles,markers,limit=candles.length){
 const visible=candles.slice(0,limit),last=visible.at(-1)?.time
 if(!visible.length)return []
 const groups=new Map()
 for(const marker of markers||[]){
  const seconds=Math.floor(Number(marker.time)/1000)
  if(!Number.isFinite(seconds)||seconds>last)continue
  let lo=0,hi=visible.length-1
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(visible[mid].time<=seconds)lo=mid;else hi=mid-1}
  const candle=visible[lo],key=`${candle.time}:${marker.side}`
  const group=groups.get(key)||{time:candle.time,side:marker.side,prices:[],count:0}
  group.count++;group.prices.push(Number(marker.price));groups.set(key,group)
 }
 return [...groups.values()].sort((a,b)=>a.time-b.time).map(group=>{
  const average=group.prices.reduce((sum,value)=>sum+value,0)/group.prices.length,buy=group.side==='Buy'
  return {time:group.time,position:buy?'belowBar':'aboveBar',color:buy?'#2b9a74':'#c85f5f',shape:buy?'arrowUp':'arrowDown',text:`${buy?'B':'S'}${group.count>1?'×'+group.count:''} ${price(average)}`}
 })
}

export default function HistoricalReplayChart({history,dark=false}){
 const hostRef=useRef(null),chartRef=useRef(null),seriesRef=useRef(null),markerPluginRef=useRef(null),limitRef=useRef(history.candles.length)
 const [limit,setLimit]=useState(history.candles.length),[playing,setPlaying]=useState(false)
 const entryIndex=useMemo(()=>{
  const time=Math.floor(Date.parse(history.trade.entry_time)/1000),index=history.candles.findIndex((candle,i)=>candle.time<=time&&(history.candles[i+1]?.time??Infinity)>time)
  return index<0?0:index
 },[history])
 useEffect(()=>{setLimit(history.candles.length);limitRef.current=history.candles.length;setPlaying(false)},[history])
 useEffect(()=>{limitRef.current=limit},[limit])
 useEffect(()=>{
  let cancelled=false,observer
  import('lightweight-charts').then(({createChart,CandlestickSeries,createSeriesMarkers,ColorType,LineStyle})=>{
   if(cancelled||!hostRef.current)return
   const styles=getComputedStyle(document.body),chart=createChart(hostRef.current,{width:hostRef.current.clientWidth,height:420,layout:{background:{type:ColorType.Solid,color:styles.getPropertyValue('--sf').trim()||(dark?'#10191b':'#fff')},textColor:styles.getPropertyValue('--mu').trim()||'#718096',fontFamily:'var(--font-sans)'},grid:{vertLines:{color:styles.getPropertyValue('--bd').trim()||'#e4e7e7'},horzLines:{color:styles.getPropertyValue('--bd').trim()||'#e4e7e7'}},rightPriceScale:{borderColor:styles.getPropertyValue('--bd2').trim()||'#cbd2d2'},timeScale:{borderColor:styles.getPropertyValue('--bd2').trim()||'#cbd2d2',timeVisible:true,secondsVisible:false,rightOffset:4,barSpacing:8},crosshair:{vertLine:{style:LineStyle.Dashed},horzLine:{style:LineStyle.Dashed}},localization:{locale:'en-US'}})
   const series=chart.addSeries(CandlestickSeries,{upColor:'#2b9a74',downColor:'#c85f5f',borderVisible:false,wickUpColor:'#2b9a74',wickDownColor:'#c85f5f',priceFormat:priceScale(history.candles)})
   const markers=createSeriesMarkers(series,[])
   if(Number(history.trade.entry_price)>0)series.createPriceLine({price:Number(history.trade.entry_price),color:'#5c8ea3',lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:true,title:'Avg entry'})
   if(Number(history.trade.exit_price)>0)series.createPriceLine({price:Number(history.trade.exit_price),color:'#988b76',lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:true,title:'Avg exit'})
   for(const pivot of history.pivots?.timeframes||[])if(pivot.nearest.distance_pct<=2)series.createPriceLine({price:Number(pivot.nearest.price),color:PIVOT_COLORS[pivot.timeframe]||'#8b9494',lineWidth:1,lineStyle:LineStyle.Dotted,axisLabelVisible:true,title:`${pivot.timeframe[0]} ${pivot.nearest.name}`})
   chartRef.current=chart;seriesRef.current=series;markerPluginRef.current=markers
   series.setData(history.candles.slice(0,limitRef.current));markers.setMarkers(chartMarkers(history.candles,history.markers,limitRef.current));chart.timeScale().fitContent()
   observer=new ResizeObserver(entries=>{const width=entries[0]?.contentRect.width;if(width)chart.applyOptions({width})});observer.observe(hostRef.current)
  }).catch(()=>{})
  return()=>{cancelled=true;observer?.disconnect();chartRef.current?.remove();chartRef.current=null;seriesRef.current=null;markerPluginRef.current=null}
 },[history,dark])
 useEffect(()=>{if(seriesRef.current){seriesRef.current.setData(history.candles.slice(0,limit));markerPluginRef.current?.setMarkers(chartMarkers(history.candles,history.markers,limit));chartRef.current?.timeScale().fitContent()}},[limit,history])
 useEffect(()=>{if(!playing)return;const timer=setInterval(()=>setLimit(current=>{if(current>=history.candles.length){setPlaying(false);return current}return current+1}),220);return()=>clearInterval(timer)},[playing,history.candles.length])
 const beginReplay=()=>{setLimit(Math.min(history.candles.length,entryIndex+1));setPlaying(true)}
 const visibleCandle=history.candles[Math.max(0,limit-1)]
 return <div className="historical-replay">
  <div className="replay-controls"><button className="btn btn-p" onClick={beginReplay}>Replay from entry</button><button className="btn" disabled={limit>=history.candles.length&&!playing} onClick={()=>setPlaying(value=>!value)}>{playing?'Pause':'Continue'}</button><button className="text-button" onClick={()=>{setPlaying(false);setLimit(history.candles.length)}}>Show full period</button><span>{visibleCandle?new Date(visibleCandle.time*1000).toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})+' UTC':''}</span></div>
  <input className="replay-scrubber" aria-label="Historical replay position" type="range" min="1" max={history.candles.length} value={Math.max(1,limit)} onChange={event=>{setPlaying(false);setLimit(Number(event.target.value))}}/>
  <div ref={hostRef} className="historical-chart-canvas" role="img" aria-label={`${history.source.label} candlestick chart with ${history.markers.length} execution markers and ${(history.pivots?.timeframes||[]).filter(pivot=>pivot.nearest.distance_pct<=2).length} nearby pivot lines`}/>
  <details className="execution-marker-list"><summary>{history.markers.length} execution marker{history.markers.length===1?'':'s'} · accessible list</summary><div className="tw"><table><thead><tr><th>Time · UTC</th><th>Side</th><th>Price</th><th>Quantity</th><th>Basis</th></tr></thead><tbody>{history.markers.map((marker,index)=><tr key={`${marker.time}-${index}`}><td>{new Date(marker.time).toISOString().slice(0,19).replace('T',' ')}</td><td>{marker.side}</td><td>{price(marker.price)}</td><td>{marker.quantity==null?'—':price(marker.quantity)}</td><td>{marker.source}</td></tr>)}</tbody></table></div></details>
 </div>
}
