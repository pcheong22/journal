import { createHash, randomUUID } from 'node:crypto'
import { BACKUP_VERSION, BACKUP_LIMIT, FILE_LIMIT, BACKUP_TABLES, canonicalJSON, backupCounts, validStoragePath, validateBackupShape } from './backupFormat'
const BUCKET = 'journal-backups'
const hash = value => createHash('sha256').update(value).digest('hex')
const check = result => { if (result.error) throw new Error(result.error.message); return result.data }
const project = () => new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
export async function exportSnapshot(client) { return check(await client.rpc('journal_export_data')) }

async function listFiles(client,bucket,prefix='',depth=0) {
  if (depth > 3) throw new Error('Unexpected storage folder structure.')
  const paths = []
  for (let offset=0;;offset+=1000) {
    const data = check(await client.storage.from(bucket).list(prefix,{limit:1000,offset,sortBy:{column:'name',order:'asc'}})) || []
    for (const entry of data) {
      const path = prefix ? prefix + '/' + entry.name : entry.name
      if (!entry.id) paths.push(...await listFiles(client,bucket,path,depth+1))
      else {
        if (!validStoragePath(bucket,path)) throw new Error('Unexpected stored file path; backup stopped to avoid omitting files.')
        paths.push({bucket,path})
      }
      if (paths.length > 2000) throw new Error('Backup exceeds 2,000 files.')
    }
    if (data.length < 1000) return paths
  }
}
export async function createFullBackup(client, settings={}, reason='manual') {
  const snapshot = await exportSnapshot(client)
  const paths = [...await listFiles(client,'trade-images'), ...await listFiles(client,'trade-executions')]
  for(const job of snapshot.tables.journal_imports || []) {
    if(!validStoragePath('journal-imports',job.source_path))throw new Error('Invalid original export path.')
    if(!paths.some(f=>f.bucket==='journal-imports'&&f.path===job.source_path))paths.push({bucket:'journal-imports',path:job.source_path})
  }
  let total = 0
  const files=[]
  for (const file of paths) {
    const blob = check(await client.storage.from(file.bucket).download(file.path))
    total += blob.size
    if (total > FILE_LIMIT) throw new Error('Attached files exceed the 20 MB full-backup limit.')
    const bytes = Buffer.from(await blob.arrayBuffer())
    files.push({...file,size:bytes.length,sha256:hash(bytes),data:bytes.toString('base64'),contentType:blob.type || 'application/octet-stream'})
  }
  // Catch edits/imports/deletions while storage was being read.
  if ((await exportSnapshot(client)).digest !== snapshot.digest) throw new Error('Journal changed during backup. Please retry.')
  const imagePrefix=process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, '') + '/storage/v1/object/public/trade-images/'
  const inventory=new Set(files.map(file=>file.bucket+'/'+file.path))
  for (const image of snapshot.tables.trade_images) {
    if (typeof image.url!=='string' || !image.url.startsWith(imagePrefix) || !inventory.has('trade-images/'+decodeURIComponent(image.url.slice(imagePrefix.length)))) throw new Error('A screenshot record has missing stored bytes. Backup stopped rather than omit it.')
  }
  const payload = { format:'tradeintel-full-backup',version:BACKUP_VERSION,project:project(),createdAt:new Date().toISOString(),snapshot,files,settings }
  const document = {...payload,checksum:hash(canonicalJSON(payload))}
  const bytes=Buffer.from(JSON.stringify(document))
  if (bytes.length > BACKUP_LIMIT) throw new Error('Backup exceeds 50 MB.')
  const id=randomUUID(), path=`exports/${id}.json`, counts=backupCounts(snapshot)
  check(await client.storage.from(BUCKET).upload(path,bytes,{contentType:'application/json',upsert:false,cacheControl:'0'}))
  const record = check(await client.from('journal_backups').insert({id,path,kind:'export',checksum:document.checksum,bytes:bytes.length,counts,reason}).select().single())
  return {record,document}
}
export async function backupRecord(client,id) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid backup ID.')
  const record=check(await client.from('journal_backups').select('*').eq('id',id).single())
  if (!/^(exports|uploads)\/[a-f0-9-]{36}\.json$/.test(record.path)) throw new Error('Invalid stored backup path.')
  return record
}
export async function readBackup(client,id) {
  const record=await backupRecord(client,id)
  const blob=check(await client.storage.from(BUCKET).download(record.path))
  if (blob.size > BACKUP_LIMIT) throw new Error('Backup exceeds 50 MB.')
  let document
  try { document=JSON.parse(await blob.text()) } catch { throw new Error('Choose a valid JSON backup file.') }
  validateBackupShape(document,project())
  const {checksum,...payload}=document
  if (checksum !== hash(canonicalJSON(payload))) throw new Error('Backup checksum failed. The file has changed or is damaged.')
  let total=0
  for (const file of document.files) {
    const data=Buffer.from(file.data,'base64');total+=data.length
    if (data.length!==file.size || hash(data)!==file.sha256 || total > FILE_LIMIT) throw new Error('Backup attachment checksum or size failed.')
  }
  // Every image record must point at bytes included in the full backup.
  const prefix=process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, '') + '/storage/v1/object/public/trade-images/'
  const inventory=new Set(document.files.map(file=>file.bucket+'/'+file.path))
  for (const image of document.snapshot.tables.trade_images) {
    if (typeof image.url !== 'string' || !image.url.startsWith(prefix) || !inventory.has('trade-images/'+decodeURIComponent(image.url.slice(prefix.length)))) throw new Error('Backup is missing a referenced screenshot.')
  }
  return {record,document}
}
export async function backupDownload(client,id) {
  const record=await backupRecord(client,id)
  const data=check(await client.storage.from(BUCKET).createSignedUrl(record.path,60,{download:`tradeintel-backup-${record.created_at.slice(0,10)}.json`}))
  return data.signedUrl
}
export async function prepareRestoreUpload(client) {
  const id=randomUUID(),path=`uploads/${id}.json`
  check(await client.from('journal_backups').insert({id,path,kind:'restore_upload',reason:'uploaded restore candidate'}))
  const data=check(await client.storage.from(BUCKET).createSignedUploadUrl(path))
  return {id,url:data.signedUrl}
}
export async function restoreFullBackup(client,id,expectedDigest,expectedChecksum,settings) {
  const {document}=await readBackup(client,id)
  if (document.checksum!==expectedChecksum) throw new Error('Backup changed after preview. Review it again.')
  const current=await exportSnapshot(client)
  if (current.digest!==expectedDigest) throw Object.assign(new Error('Journal changed after preview. Review a fresh preview.'),{status:409})
  if (current.schema!==document.snapshot.schema) throw new Error('Backup schema is incompatible with this journal version.')
  // This complete checkpoint survives the subsequent database transaction.
  const {record:safety}=await createFullBackup(client,settings,'automatic safety copy before restore')
  for (const file of document.files) {
    const result=await client.storage.from(file.bucket).download(file.path)
    if (!result.error) {
      const existing=Buffer.from(await result.data.arrayBuffer())
      if (hash(existing)!==file.sha256) throw new Error('A stored file differs from the backup. Nothing was overwritten; contact support.')
    } else {
      if (!['404','400','not_found','NoSuchKey'].includes(String(result.error.statusCode || result.error.code)) && !/not found|does not exist/i.test(result.error.message || '')) throw new Error('Could not verify stored files. Restore stopped.')
      check(await client.storage.from(file.bucket).upload(file.path,Buffer.from(file.data,'base64'),{contentType:file.contentType,upsert:false,cacheControl:'0'}))
    }
  }
  const result=await client.rpc('journal_restore_data',{p_snapshot:document.snapshot,p_expected_digest:expectedDigest,p_safety_id:safety.id})
  if (result.error) throw Object.assign(new Error(result.error.code==='40001' ? 'Journal changed during restore preparation. Review a fresh preview.' : 'Restore failed; database changes were rolled back. Your safety backup is available.'),{status:result.error.code==='40001'?409:503})
  return { ...result.data,counts:backupCounts(document.snapshot),settings:document.settings || {} }
}
