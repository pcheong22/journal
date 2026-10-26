import { canonicalSymbol } from './symbols'
import { matchesHyperliquidTrade } from './hyperliquidImport'
export const SOURCE_FIELDS=['position_id','account_id','broker','entry_time','exit_time','symbol','direction','size','entry_price','exit_price','notional_usd','notional_method','pnl','pct_gain','fee','duration_mins','currency','session','day_of_week','tv_symbol','raw_direction','order_type']
const JOURNAL_FIELDS=['notes','note_entry_reason','note_management','note_lessons','note_emotional_state','stop_loss','strategy_id']
const equal=(a,b)=>a==null&&b==null || typeof a==='number'&&typeof b==='number' ? a==null&&b==null || Math.abs(a-b)<=1e-8 : a===b
export function sourceRecord(trade) {return Object.fromEntries(SOURCE_FIELDS.filter(key=>Object.hasOwn(trade,key)).map(key=>[key,trade[key]]))}
export function changedSource(before,after) {
 return Object.entries(after).filter(([key,value])=>!(key.endsWith('_time') && before[key]!=null && value!=null ? Date.parse(before[key])===Date.parse(value) : equal(before[key]??null,value??null))).map(([field,value])=>({field,before:before[field]??null,after:value??null}))
}
const near=(a,b,tolerance=1e-6)=>a!=null&&b!=null&&Math.abs(Number(a)-Number(b))<=tolerance
const sameClose=(a,b)=>canonicalSymbol(a.symbol)===canonicalSymbol(b.symbol)&&a.direction===b.direction&&Date.parse(a.exit_time)===Date.parse(b.exit_time)&&near(a.size,b.size)&&near(a.pnl,b.pnl,.011)&&near(a.exit_price,b.exit_price,.0001)
const annotated=(trade,snapshot)=>Boolean(trade._execution_count) || JOURNAL_FIELDS.some(key=>trade[key]!=null&&trade[key]!=='') || snapshot.tags.some(row=>row.trade_id===trade.id) || snapshot.images.some(row=>row.entity_id===String(trade.id))
export function buildImportPlan(parsed,snapshot,provenance={}) {
 const operations=[],rows=[],claims=new Set(),warnings=[...(parsed.warnings || [])]
 const counts={inserted:0,updated:0,removed:0,skipped:0,blocked:0}
 let needsReview=false
 const seenIncoming=new Set()
 for(let index=0;index<parsed.trades.length;index++){
  const incoming=parsed.trades[index],sourceIds=[...new Set(incoming._source_ids || [])]
  if(seenIncoming.has(incoming.position_id))throw new Error('The export contains colliding position identities. No trades changed.')
  seenIncoming.add(incoming.position_id)
  let matches=snapshot.trades.filter(row=>row.position_id===incoming.position_id)
  if(!matches.length && parsed.broker==='Hyperliquid' && !parsed.hypurrscan)matches=snapshot.trades.filter(row=>matchesHyperliquidTrade(row,incoming,parsed.utcTrades?.[index]))
  if(!matches.length && parsed.broker==='PrimeXBT')matches=snapshot.trades.filter(row=>row.position_id.replace(/_g\d+$/,'')===incoming.position_id || sourceIds.includes('pxt:'+row.position_id.replace(/_g\d+$/,'')))
  if(!matches.length && parsed.hypurrscan)matches=snapshot.trades.filter(row=>canonicalSymbol(row.symbol)===canonicalSymbol(incoming.symbol)&&row.direction===incoming.direction&&Math.abs(Date.parse(row.exit_time)-Date.parse(incoming.exit_time))<=5000&&near(row.size,incoming.size)&&near(row.exit_price,incoming.exit_price,.0001))
  if(!matches.length)matches=snapshot.trades.filter(row=>sameClose(row,incoming))
  if(matches.some(row=>claims.has(row.id))){counts.blocked++;rows.push({status:'blocked',symbol:incoming.symbol,position:incoming.position_id,reason:'Several incoming rows claim the same saved trade. Use a complete history with execution IDs.'});continue}
  if(matches.length>1){
   const withNotes=matches.filter(row=>annotated(row,snapshot))
   if(withNotes.length>1 || parsed.broker!=='Hyperliquid'){counts.blocked++;rows.push({status:'blocked',symbol:incoming.symbol,position:incoming.position_id,reason:'Multiple saved trades match; separate notes or uncertain identity prevent automatic merging.'});continue}
   matches.sort((a,b)=>Number(annotated(b,snapshot))-Number(annotated(a,snapshot)) || a.id-b.id)
  }
  const before=matches[0]
  const after=sourceRecord(incoming)
  if(before){
   matches.forEach(row=>claims.add(row.id))
   // Keep the established journal identity and all attached annotations.
   after.position_id=before.position_id
   if(canonicalSymbol(after.symbol)===canonicalSymbol(before.symbol))after.symbol=before.symbol
   if(incoming.entry_price==null && before.entry_price!=null)after.entry_price=before.entry_price
   if(incoming.entry_time==null && before.entry_time!=null){after.entry_time=before.entry_time;after.duration_mins=before.duration_mins}
   if(parsed.broker==='Hyperliquid' && !parsed.hypurrscan){if(before.entry_price!=null)after.entry_price=before.entry_price;if(before.order_type)after.order_type=before.order_type}
   if(parsed.hypurrscan){after.pnl=before.pnl;after.fee=before.fee;after.notional_usd=before.notional_usd;after.notional_method=before.notional_method;after.currency=before.currency}
   const known=provenance[before.id] || []
   const missing=known.filter(id=>!sourceIds.includes(id))
   const older=Date.parse(incoming.exit_time)<Date.parse(before.exit_time) || missing.length>0 && sourceIds.every(id=>known.includes(id))
   if(older){counts.skipped++;rows.push({status:'skipped',symbol:incoming.symbol,position:before.position_id,reason:'Older or incomplete export; saved history retained.'});continue}
   if(missing.length && sourceIds.some(id=>!known.includes(id)))needsReview=true
   const changes=changedSource(before,after)
   const deletes=matches.slice(1)
   for(const duplicate of deletes){operations.push({kind:'delete',before:duplicate});counts.removed++}
   if(changes.length){
    operations.push({kind:'update',before,after,sourceIds,incomingPosition:incoming.position_id});counts.updated++
    if(changes.some(change=>['pnl','size','currency','entry_time','exit_time','entry_price','exit_price'].includes(change.field)))needsReview=true
    rows.push({status:'updated',symbol:incoming.symbol,position:before.position_id,changes,sourceCount:sourceIds.length})
   }else{counts.skipped++;rows.push({status:'skipped',symbol:incoming.symbol,position:before.position_id,reason:deletes.length?'Duplicate copies reconciled; annotated trade retained.':'Already imported; no journal data changed.',sourceCount:sourceIds.length})}
   // Record source coverage even when this upload makes no source-field changes.
   if(!changes.length)operations.push({kind:'coverage',before:{id:before.id,position_id:before.position_id},sourceIds,incomingPosition:incoming.position_id})
  }else{
   if(!Number.isFinite(after.pnl)){counts.blocked++;rows.push({status:'blocked',symbol:incoming.symbol,position:incoming.position_id,reason:'No reported P&L or complete opening prices are available.'});continue}
   const uncertain=snapshot.trades.filter(row=>canonicalSymbol(row.symbol)===canonicalSymbol(incoming.symbol)&&row.direction===incoming.direction&&Date.parse(row.exit_time)===Date.parse(incoming.exit_time))
   if(uncertain.length){counts.blocked++;rows.push({status:'blocked',symbol:incoming.symbol,position:incoming.position_id,reason:'A saved trade closes at this time but has different values. Resolve the source discrepancy before importing.'});continue}
   operations.push({kind:'insert',after,sourceIds,incomingPosition:incoming.position_id});counts.inserted++
   rows.push({status:'new',symbol:incoming.symbol,position:incoming.position_id,pnl:incoming.pnl,currency:incoming.currency,sourceCount:sourceIds.length})
   if(parsed.hypurrscan)needsReview=true
  }
 }
 if(counts.blocked)warnings.push(`${counts.blocked} ambiguous or incomplete positions cannot be imported from this file. No journal changes will be made until they are resolved.`)
 return {operations,rows,counts,warnings,needsReview,accountDigest:snapshot.digest,broker:parsed.broker,accountId:parsed.accountId,currency:parsed.currency,version:1}
}
