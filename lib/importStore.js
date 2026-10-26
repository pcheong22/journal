import { createHash,randomUUID } from 'node:crypto'
import { gzipSync,gunzipSync } from 'node:zlib'
import { parseImportFile,IMPORT_VERSION } from './importFile'
import { buildImportPlan } from './importPlan'
import { createFullBackup } from './backupStore'
import { sourceIdentity } from './importIdentity'
import { saveExecutionRecords,executionIndex,readExecutionRecord } from './executionStore'
const bucket='journal-imports',limit=20*1024*1024
const hash=b=>createHash('sha256').update(b).digest('hex')
const check=r=>{if(r.error)throw new Error(r.error.message);return r.data}
export async function importRecord(client,id){if(!/^[a-f0-9-]{36}$/.test(id || ''))throw new Error('Invalid import.');return check(await client.from('journal_imports').select('*').eq('id',id).single())}
export async function prepareImport(client,{filename,size,sha}){
 if(typeof filename!=='string'||filename.length>200||! /\.(csv|xlsx|xls)$/i.test(filename)||!Number.isSafeInteger(size)||size<1||size>limit||! /^[a-f0-9]{64}$/.test(sha || ''))throw new Error('Choose a CSV or Excel export smaller than 20 MB.')
 const previous=check(await client.from('journal_imports').select('source_path').eq('file_sha',sha).eq('source_verified',true).limit(1))?.[0]
 const id=randomUUID(),path=previous?.source_path || `${id}/upload`
 check(await client.from('journal_imports').insert({id,filename,file_sha:sha,source_path:path,source_size:size,source_verified:!!previous,parser_version:IMPORT_VERSION}))
 return {id,url:previous?null:check(await client.storage.from(bucket).createSignedUploadUrl(path)).signedUrl}
}
async function readSource(client,job){
 const blob=check(await client.storage.from(bucket).download(job.source_path));if(blob.size>limit)throw new Error('Export is too large.')
 let bytes=Buffer.from(await blob.arrayBuffer());if(job.source_verified)bytes=gunzipSync(bytes,{maxOutputLength:limit})
 if(bytes.length!==job.source_size||hash(bytes)!==job.file_sha)throw new Error('Export checksum failed. Upload the original file again.')
 if(!job.source_verified){
  const path=`${job.file_sha}/source.gz`,packed=gzipSync(bytes)
  const uploaded=await client.storage.from(bucket).upload(path,packed,{contentType:'application/gzip',upsert:false})
  if(uploaded.error){const stored=check(await client.storage.from(bucket).download(path));if(hash(gunzipSync(Buffer.from(await stored.arrayBuffer()),{maxOutputLength:limit}))!==job.file_sha)throw new Error('Stored original export failed validation.')}
  check(await client.from('journal_imports').update({source_path:path,source_verified:true}).eq('id',job.id));await client.storage.from(bucket).remove([job.source_path])
 }
 return bytes
}
export async function previewImport(client,id,accountId,timezone='Asia/Dubai',correctCurrency=false){
 const job=await importRecord(client,id);if(!['uploaded','preview'].includes(job.status))throw new Error('This import has already completed.')
 if(!['Asia/Dubai','UTC'].includes(timezone))throw new Error('Choose Dubai time or UTC.')
 let parsed=parseImportFile(await readSource(client,job),job.filename,accountId,timezone)
 const accounts=check(await client.from('accounts').select('*'))
 let target=accounts.find(a=>a.broker===parsed.broker&&a.id.toLowerCase()===parsed.accountId.toLowerCase())
 if(!target&&!accountId&&parsed.legacyAccountId)target=accounts.find(a=>a.broker===parsed.broker&&a.id===parsed.legacyAccountId)
 if(parsed.accountId==='PENDING_ACCOUNT')return {id,needsAccount:true,broker:parsed.broker,accounts:accounts.filter(a=>a.broker===parsed.broker)}
 if(target&&target.id!==parsed.accountId)parsed=parseImportFile(await readSource(client,await importRecord(client,id)),job.filename,target.id,timezone)
 const snapshot=check(await client.rpc('journal_import_snapshot',{p_account:parsed.accountId}))
 const prior=check(await client.from('journal_imports').select('result').eq('account_id',parsed.accountId).eq('status','committed').order('committed_at',{ascending:true}).limit(1000))
 const provenance={};for(const entry of prior)for(const row of entry.result?.coverage || [])provenance[row.trade_id]=row.source_ids
 const executionFiles=await executionIndex(client,parsed.accountId)
 for(const trade of snapshot.trades){if(executionFiles[trade.id]){const record=await readExecutionRecord(client,trade);if(record){trade._execution_count=record.fills.length;if(!provenance[trade.id])provenance[trade.id]=record.fills.map(fill=>sourceIdentity('FILL',[fill.source_key]))}}}
 const plan=buildImportPlan(parsed,snapshot,provenance)
 const currencyMismatch=!!target&&target.currency!==parsed.currency
 plan.account={id:parsed.accountId,broker:parsed.broker,label:target?.label||`${parsed.broker} ${parsed.accountId.slice(-8)}`,currency:parsed.currency,color:target?.color||'#6389ff'}
 plan.accountCurrencyCorrection=currencyMismatch&&correctCurrency;plan.accountChanged=!target||plan.accountCurrencyCorrection
 if(currencyMismatch&&!correctCurrency){plan.counts.blocked++;plan.warnings.push(`Account currency is ${target.currency}, while this file reports ${parsed.currency}. Confirm the currency correction and refresh the preview.`)}
 plan.needsReview=plan.needsReview||currencyMismatch||!parsed.audit.matched
 plan.audit=parsed.audit;plan.timezone=parsed.timezone;plan.sourceAccountId=parsed.sourceAccountId
 if(Buffer.byteLength(JSON.stringify(plan))>20*1024*1024)throw new Error('Preview is too large. Use a shorter export period.')
 check(await client.from('journal_imports').update({broker:parsed.broker,account_id:parsed.accountId,timezone,parser_version:IMPORT_VERSION,status:'preview',plan,counts:plan.counts,previewed_at:new Date().toISOString()}).eq('id',id))
 return {id,...plan,operations:undefined,currencyMismatch,accounts:undefined}
}
async function saveDetails(client,job,result){
 try{
  const parsed=parseImportFile(await readSource(client,job),job.filename,job.account_id,job.timezone)
  const mapping=new Map((result.coverage || []).map(row=>[row.incoming_position,row.position_id]))
  parsed.executions=(parsed.executions || []).filter(e=>mapping.has(e.position_id)).map(e=>({...e,position_id:mapping.get(e.position_id)}))
  await saveExecutionRecords(client,parsed,job.filename,job.timezone)
  check(await client.from('journal_imports').update({details_status:'complete',details_error:null}).eq('id',job.id));return null
 }catch(error){check(await client.from('journal_imports').update({details_status:'failed',details_error:String(error.message).slice(0,500)}).eq('id',job.id));return 'Trades saved. Execution details need a retry from import history.'}
}
export async function commitImport(client,id,reviewed=false){
 const job=await importRecord(client,id)
 if(job.status==='committed')return {...job.result,warning:await saveDetails(client,job,job.result)}
 if(job.status!=='preview'||job.plan?.counts?.blocked)throw new Error('Review a valid preview first.')
 if(job.plan.needsReview&&!reviewed)throw new Error('Confirm the source differences and warnings before importing.')
 let safety=null
 if(job.plan.accountChanged||job.plan.operations.some(op=>op.kind!=='coverage'))safety=(await createFullBackup(client,{},`before import ${job.filename}`)).record.id
 const result=check(await client.rpc('journal_apply_import',{p_id:id,p_safety:safety}))
 return {...result,warning:await saveDetails(client,job,result)}
}
