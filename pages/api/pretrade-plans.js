import { createClient } from '@supabase/supabase-js'
import { requireOwner } from '../../lib/serverAuth'
import { evaluatePlan, planSnapshot } from '../../lib/pretradeChecklist'
import { createFullBackup } from '../../lib/backupStore'

const supabase=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY)
const statuses=new Set(['draft','ready','taken','passed','cancelled'])
const fieldsFrom=(evaluation,userId)=>({
  user_id:userId,account_id:evaluation.account_id,symbol:evaluation.symbol,direction:evaluation.direction,
  setup_type:evaluation.setup_type,planned_at:evaluation.planned_at,entry_price:evaluation.entry_price,
  stop_price:evaluation.stop_price,target_price:evaluation.target_price,pivot_timeframe:evaluation.pivot_timeframe,
  pivot_name:evaluation.pivot_name,pivot_price:evaluation.pivot_price,thesis:evaluation.thesis,
  invalidation:evaluation.invalidation,notes:evaluation.notes,checklist:evaluation.checks,score:evaluation.score,
  grade:evaluation.grade,gate_results:evaluation.gates,reward_risk:evaluation.reward_risk,
})

export default async function handler(req,res){
  const user=await requireOwner(req,res);if(!user)return
  if(req.method==='GET'){
    const {data,error}=await supabase.from('pretrade_plans').select('*').eq('user_id',user.id).order('updated_at',{ascending:false}).limit(250)
    if(error)return res.status(500).json({error:'Could not load pre-trade plans.'})
    return res.status(200).json({plans:data||[]})
  }
  if(req.method==='POST'){
    const evaluation=evaluatePlan(req.body)
    if(!evaluation.symbol)return res.status(400).json({error:'Add an instrument before saving this plan.'})
    const snapshot=planSnapshot(evaluation),requested=statuses.has(req.body.status)?req.body.status:'draft'
    const status=['ready','taken'].includes(requested)&&!evaluation.ready?'draft':requested
    const {data,error}=await supabase.from('pretrade_plans').insert({...fieldsFrom(evaluation,user.id),status,original_snapshot:snapshot,revisions:[{version:1,saved_at:new Date().toISOString(),snapshot}]}).select().single()
    if(error)return res.status(500).json({error:'Could not save the pre-trade plan.'})
    return res.status(201).json({plan:data})
  }
  if(req.method==='PATCH'){
    const id=String(req.body.id||''),expected=Number(req.body.revision)
    if(!/^[a-f0-9-]{36}$/.test(id)||!Number.isSafeInteger(expected))return res.status(400).json({error:'Reload this plan and try again.'})
    const {data:current,error:readError}=await supabase.from('pretrade_plans').select('*').eq('id',id).eq('user_id',user.id).single()
    if(readError||!current)return res.status(404).json({error:'This plan could not be found.'})
    if(current.revision!==expected)return res.status(409).json({error:'This plan changed in another window. Reload before saving.'})
    const evaluation=evaluatePlan(req.body),snapshot=planSnapshot(evaluation),requested=statuses.has(req.body.status)?req.body.status:current.status
    const status=['ready','taken'].includes(requested)&&!evaluation.ready?'draft':requested
    const revisions=[...(Array.isArray(current.revisions)?current.revisions:[]),{version:expected+1,saved_at:new Date().toISOString(),snapshot}].slice(-100)
    const {data,error}=await supabase.from('pretrade_plans').update({...fieldsFrom(evaluation,user.id),status,revisions,revision:expected+1,updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',user.id).eq('revision',expected).select().single()
    if(error||!data)return res.status(error?.code==='PGRST116'?409:500).json({error:error?.code==='PGRST116'?'This plan changed in another window. Reload before saving.':'Could not update the pre-trade plan.'})
    return res.status(200).json({plan:data})
  }
  if(req.method==='DELETE'){
    const id=String(req.query.id||'')
    if(!/^[a-f0-9-]{36}$/.test(id))return res.status(400).json({error:'Choose a valid plan.'})
    try{await createFullBackup(supabase,{},'automatic safety copy before deleting pre-trade plan')}catch{return res.status(503).json({error:'Could not create the safety backup. Nothing was deleted; please retry.'})}
    const {error}=await supabase.from('pretrade_plans').delete().eq('id',id).eq('user_id',user.id)
    if(error)return res.status(500).json({error:'Could not delete the pre-trade plan.'})
    return res.status(200).json({ok:true})
  }
  res.setHeader('Allow','GET, POST, PATCH, DELETE');return res.status(405).json({error:'Method not allowed'})
}
