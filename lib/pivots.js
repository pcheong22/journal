export const PIVOT_TIMEFRAMES=['Weekly','Monthly','Quarterly','Yearly']
export const PIVOT_LEVEL_ORDER=['P','R1','S1','R2','S2','R3','S3','R4','S4','R5','S5']

const finite=value=>{const number=Number(value);return Number.isFinite(number)?number:null}
const seconds=value=>{const parsed=typeof value==='number'?value:Date.parse(value)/1000;return Number.isFinite(parsed)?Math.floor(parsed):null}

export function traditionalPivots({high,low,close}={}){
  const h=finite(high),l=finite(low),c=finite(close)
  if(h==null||l==null||c==null||l>h)return null
  const p=(h+l+c)/3
  return {P:p,R1:2*p-l,S1:2*p-h,R2:p+(h-l),S2:p-(h-l),R3:2*p+(h-2*l),S3:2*p-(2*h-l),R4:3*p+(h-3*l),S4:3*p-(3*h-l),R5:4*p+(h-4*l),S5:4*p-(4*h-l)}
}

export function periodStart(value,timeframe){
  const time=seconds(value);if(time==null)return null
  const date=new Date(time*1000),year=date.getUTCFullYear(),month=date.getUTCMonth(),day=date.getUTCDate()
  if(timeframe==='Yearly')return Date.UTC(year,0,1)/1000
  if(timeframe==='Quarterly')return Date.UTC(year,Math.floor(month/3)*3,1)/1000
  if(timeframe==='Monthly')return Date.UTC(year,month,1)/1000
  if(timeframe==='Weekly'){const mondayOffset=(date.getUTCDay()+6)%7;return Date.UTC(year,month,day-mondayOffset)/1000}
  return null
}

export function nextPeriodStart(start,timeframe){
  const date=new Date(Number(start)*1000),year=date.getUTCFullYear(),month=date.getUTCMonth(),day=date.getUTCDate()
  if(timeframe==='Yearly')return Date.UTC(year+1,0,1)/1000
  if(timeframe==='Quarterly')return Date.UTC(year,month+3,1)/1000
  if(timeframe==='Monthly')return Date.UTC(year,month+1,1)/1000
  if(timeframe==='Weekly')return Date.UTC(year,month,day+7)/1000
  return null
}

export function aggregatePeriods(candles,timeframe){
  const groups=new Map()
  for(const candle of [...(candles||[])].sort((a,b)=>a.time-b.time)){
    const start=periodStart(candle.time,timeframe),open=finite(candle.open),high=finite(candle.high),low=finite(candle.low),close=finite(candle.close)
    if(start==null||[open,high,low,close].some(value=>value==null)||low>high)continue
    const existing=groups.get(start)
    if(!existing)groups.set(start,{start,end:nextPeriodStart(start,timeframe),open,high,low,close,first:candle.time,last:candle.time})
    else{existing.high=Math.max(existing.high,high);existing.low=Math.min(existing.low,low);if(candle.time<existing.first){existing.first=candle.time;existing.open=open}if(candle.time>=existing.last){existing.last=candle.time;existing.close=close}}
  }
  return [...groups.values()].sort((a,b)=>a.start-b.start)
}

export function nearestPivot(entry,levels){
  const price=finite(entry);if(price==null||price===0||!levels)return null
  let nearest=null
  for(const name of PIVOT_LEVEL_ORDER){const level=finite(levels[name]);if(level==null)continue;const distance=Math.abs(price-level),distancePct=distance/Math.abs(price)*100
    if(!nearest||distance<nearest.distance)nearest={name,price:level,distance,distance_pct:distancePct,entry_side:distancePct<1e-9?'at':price>level?'above':'below'}
  }
  return nearest
}

export function pivotContext(candles,trade){
  const entryTime=seconds(trade?.entry_time),entryPrice=finite(trade?.entry_price)
  if(entryTime==null||entryPrice==null)return {method:'Traditional',timezone:'UTC',timeframes:[],available:false}
  const timeframes=[]
  for(const timeframe of PIVOT_TIMEFRAMES){
    const currentStart=periodStart(entryTime,timeframe),periods=aggregatePeriods(candles,timeframe),previous=[...periods].reverse().find(period=>period.start<currentStart)
    if(!previous)continue
    const levels=traditionalPivots(previous),nearest=nearestPivot(entryPrice,levels)
    if(nearest)timeframes.push({timeframe,current_start:currentStart,current_end:nextPeriodStart(currentStart,timeframe),source_period:{start:previous.start,end:previous.end,high:previous.high,low:previous.low,close:previous.close},levels,nearest})
  }
  return {method:'Traditional',timezone:'UTC',timeframes,available:timeframes.length>0}
}

export function pivotReferenceWindow(trade){
  const entry=seconds(trade?.entry_time);if(entry==null)throw new Error('This trade has no usable entry time for pivot calculations.')
  const date=new Date(entry*1000),start=Date.UTC(date.getUTCFullYear()-1,0,1),end=Math.min(Date.now()+86400000,entry*1000+2*86400000)
  return {start,end}
}
