import { createClient } from '@supabase/supabase-js'
import { requireOwner } from '../../lib/serverAuth'
import { readExecutionRecord } from '../../lib/executionStore'
import { defaultHistoryInterval, executionMarkers, fetchMarketHistory, fetchPivotReference, HISTORY_INTERVALS } from '../../lib/marketHistory'
import { pivotContext } from '../../lib/pivots'

const supabase=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY)

export default async function handler(req,res){
  if(!await requireOwner(req,res))return
  res.setHeader('Cache-Control','private, max-age=300, stale-while-revalidate=600')
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'})
  if(!/^\d+$/.test(String(req.query.tradeId||'')))return res.status(400).json({error:'A valid trade ID is required'})
  if(req.query.interval&&!HISTORY_INTERVALS.includes(req.query.interval))return res.status(400).json({error:'Unsupported chart interval'})
  try{
    const {data:trade,error}=await supabase.from('trades').select('id,account_id,position_id,broker,symbol,original_symbol,direction,entry_time,exit_time,entry_price,exit_price,duration_mins').eq('id',req.query.tradeId).single()
    if(error||!trade)return res.status(404).json({error:'Trade not found'})
    const interval=req.query.interval||defaultHistoryInterval(trade)
    const [history,record,pivotReference]=await Promise.all([
      fetchMarketHistory(trade,interval),
      readExecutionRecord(supabase,trade).catch(markerError=>{console.error('Market history execution markers:',markerError.message);return null}),
      fetchPivotReference(trade).catch(pivotError=>{console.error('Pivot reference:',pivotError.message);return null}),
    ])
    const pivots=pivotReference?{...pivotContext(pivotReference.candles,trade),source:pivotReference.source}:null
    return res.status(200).json({history:{...history,markers:executionMarkers(trade,record),pivots,trade:{entry_time:trade.entry_time,exit_time:trade.exit_time,entry_price:trade.entry_price,exit_price:trade.exit_price,direction:trade.direction},executionCoverage:record?.coverage||'summary_only'}})
  }catch(error){
    console.error('Market history:',error.message)
    return res.status(502).json({error:error.message||'Historical chart data could not be loaded.'})
  }
}
