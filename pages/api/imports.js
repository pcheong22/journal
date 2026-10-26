import { createClient } from '@supabase/supabase-js'
import { requireOwner } from '../../lib/serverAuth'
import { prepareImport,previewImport,commitImport,importRecord } from '../../lib/importStore'
const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY)
export const config={maxDuration:60,api:{bodyParser:{sizeLimit:'128kb'}}}
export default async function handler(req,res){
 if(!await requireOwner(req,res))return
 try{
  if(req.method==='GET'){
   if(req.query.id){const job=await importRecord(client,req.query.id);if(!job.source_verified)throw new Error('Original export is not verified.');const {data,error}=await client.storage.from('journal-imports').createSignedUrl(job.source_path,60,{download:job.filename+'.gz'});if(error)throw error;return res.status(200).json({url:data.signedUrl})}
   const {data,error}=await client.from('journal_imports').select('id,filename,broker,account_id,created_at,status,counts,safety_backup,details_status,details_error').order('created_at',{ascending:false}).limit(30);if(error)throw error;return res.status(200).json({imports:data})
  }
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'})
  const {action,id,accountId,timezone,correctCurrency,reviewed}=req.body || {}
  if(action==='upload')return res.status(200).json(await prepareImport(client,req.body))
  if(action==='preview')return res.status(200).json(await previewImport(client,id,accountId,timezone,correctCurrency===true))
  if(action==='commit'||action==='retry_details')return res.status(200).json(await commitImport(client,id,reviewed===true))
  return res.status(400).json({error:'Unknown import action.'})
 }catch(error){return res.status(400).json({error:error.message || 'Import failed. No uncommitted changes were saved.'})}
}
