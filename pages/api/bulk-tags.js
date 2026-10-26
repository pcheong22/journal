import {createClient} from '@supabase/supabase-js'
import {requireOwner} from '../../lib/serverAuth'
const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY)
export default async function handler(req,res){
 if(!await requireOwner(req,res))return
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'})
 const {trades,tagId=null,remove=false}=req.body || {}
 if(!Array.isArray(trades)||trades.length<1||trades.length>200||trades.some(t=>!Number.isSafeInteger(t.id)||t.id<=0||!Number.isSafeInteger(t.revision)||t.revision<0)||tagId!==null&&(!Number.isSafeInteger(tagId)||tagId<=0)||typeof remove!=='boolean')return res.status(400).json({error:'Select up to 200 trades and a valid tag.'})
 const {data,error}=await client.rpc('journal_bulk_tag',{p_trades:trades,p_tag:tagId,p_remove:remove})
 if(error)return res.status(error.code==='40001'?409:400).json({error:error.message})
 return res.status(200).json({trades:data})
}
