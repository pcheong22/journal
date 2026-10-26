import { createClient } from '@supabase/supabase-js'
import { requireOwner } from '../../lib/serverAuth'
import { createFullBackup,backupDownload,prepareRestoreUpload,readBackup,exportSnapshot,restoreFullBackup } from '../../lib/backupStore'
import { backupCounts } from '../../lib/backupFormat'
const supabase=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY)
export const config={maxDuration:60,api:{bodyParser:{sizeLimit:'128kb'}}}
export default async function handler(req,res) {
  if (!await requireOwner(req,res)) return
  try {
    if (req.method==='GET') {
      if (req.query.id) return res.status(200).json({url:await backupDownload(supabase,req.query.id)})
      const {data,error}=await supabase.from('journal_backups').select('id,created_at,kind,bytes,counts,reason').eq('kind','export').order('created_at',{ascending:false}).limit(30)
      if(error)throw error
      return res.status(200).json({backups:data || []})
    }
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'})
    const {action,id,settings={},digest,checksum}=req.body || {}
    if(JSON.stringify(settings).length>65536 || !settings || Array.isArray(settings) || typeof settings!=='object')return res.status(400).json({error:'Invalid preferences.'})
    if(action==='export') {
      const {record}=await createFullBackup(supabase,settings)
      return res.status(200).json({id:record.id,url:await backupDownload(supabase,record.id),counts:record.counts})
    }
    if(action==='upload')return res.status(200).json(await prepareRestoreUpload(supabase))
    if(action==='preview') {
      const {document}=await readBackup(supabase,id), current=await exportSnapshot(supabase)
      if(current.schema!==document.snapshot.schema)return res.status(400).json({error:'Backup schema is incompatible with this journal version.'})
      return res.status(200).json({id,createdAt:document.createdAt,counts:backupCounts(document.snapshot),currentCounts:backupCounts(current),files:document.files.length,hasSettings:Object.keys(document.settings || {}).length>0,digest:current.digest,checksum:document.checksum})
    }
    if(action==='restore') {
      if(req.headers['x-journal-restore']!=='RESTORE JOURNAL')return res.status(400).json({error:'Type RESTORE JOURNAL to confirm replacement.'})
      return res.status(200).json(await restoreFullBackup(supabase,id,digest,checksum,settings))
    }
    return res.status(400).json({error:'Unknown backup action.'})
  } catch(error) {return res.status(error.status || 400).json({error:error.message || 'Backup operation failed. Please retry.'})}
}
