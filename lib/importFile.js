import { sourceIdentity } from './importIdentity'
import { importAudit } from './importAudit'
import * as XLSX from 'xlsx'
import { parseCSV } from './csv'
import { inspectSpreadsheet } from './uploadSafety'
import { parseTradeFile } from './tradeUtils'
import { isHypurrscan,parseHypurrscan } from './parsers/hypurrscan'
import { parseHyperliquid } from './parsers/hyperliquid'
import { extractPrimeXBTMeta } from './parsers/primexbt'
export const IMPORT_VERSION='2026-10-26.3'
export function parseImportFile(buffer,filename,accountId,timezone='Asia/Dubai') {
  inspectSpreadsheet(buffer,filename)
  let rows
  if (/\.csv$/i.test(filename)) rows=parseCSV(buffer.toString('utf8').replace(/^\uFEFF/,''))
  else {
    const book=XLSX.read(buffer,{type:'buffer',cellDates:true,sheetRows:100002})
    rows=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,raw:false,defval:''})
  }
  if (rows.length>100001 || rows.some(row=>row.length>300)) throw new Error('Export exceeds 100,000 rows or 300 columns. Use a smaller date range.')
  const hypurrscan=isHypurrscan(rows)
  // A placeholder allows a preview to ask for an unidentified account; it is never imported.
  const prime=extractPrimeXBTMeta(filename)
  const parsed=hypurrscan ? parseHypurrscan(rows,filename,accountId || 'PENDING_ACCOUNT') : parseTradeFile(rows,filename,accountId || prime.accountId || null,timezone)
  if (!parsed.trades.length) throw new Error('No valid closed trades found in this export.')
  if (parsed.trades.length>20000) throw new Error('Export exceeds 20,000 positions. Use a smaller date range.')
  if(!accountId && ['IBKR_DEFAULT','HL_DEFAULT'].includes(parsed.accountId)) {parsed.accountId='PENDING_ACCOUNT';parsed.trades.forEach(t=>t.account_id='PENDING_ACCOUNT')}
  if(parsed.broker==='PrimeXBT'&&!prime.currency)throw new Error('PrimeXBT filenames must include account and currency, for example L259832_USDC_orders.csv.')
  parsed.hypurrscan=hypurrscan
  parsed.utcTrades=parsed.broker==='Hyperliquid' && !hypurrscan ? parseHyperliquid(rows,filename,parsed.accountId,'UTC').trades : []
  parsed.sourceAccountId=parsed.broker==='PrimeXBT' ? prime.accountId : parsed.accountId==='PENDING_ACCOUNT' ? null : parsed.accountId
  parsed.legacyAccountId=parsed.broker==='PrimeXBT' ? prime.legacyAccountId : null
  parsed.sourceRows=rows.length-1
  parsed.timezone=['TxFlow','Hyperliquid'].includes(parsed.broker) && !hypurrscan ? timezone : 'UTC'
  parsed.warnings=[]
  if(parsed.broker==='Hyperliquid' && !hypurrscan)parsed.warnings.push('Native Hyperliquid rows do not provide execution IDs. Timing-based close groups are estimates; original fill rows are retained.')
  if(parsed.broker==='PrimeXBT')parsed.warnings.push('Closes within 30 minutes are consolidated. Zero-P&L orders cannot reliably distinguish opening orders from breakeven closes. Entry matching is inferred from available orders.')
  if(parsed.broker==='Extended')parsed.warnings.push('This export is consolidated by market, side and UTC day. Separate round trips on one day cannot be verified from this format; use complete daily coverage.')
  if(parsed.broker==='IBKR')parsed.warnings.push('Entry prices and times use inferred FIFO opening history, which may differ from statement tax lots. Currency is retained per trade. Missing opening history stays blank.')
  if(parsed.broker==='Bybit')parsed.warnings.push('This processed export has no immutable exchange execution IDs. Identical rows are retained separately; corrections with ambiguous matches require review.')
  if(hypurrscan)parsed.warnings.push('Hypurrscan enriches matched journal positions without replacing their reported P&L. New positions use estimated price-based P&L less exported fees.')
  if(!['TxFlow','Hyperliquid'].includes(parsed.broker))parsed.warnings.push('Naive timestamps in this export are currently interpreted as UTC. Confirm the source timezone before importing.')
  const executionMap=new Map((parsed.executions || []).map(entry=>[entry.position_id,entry]))
  for (const trade of parsed.trades) {
    const execution=executionMap.get(trade.position_id)
    if (execution) trade._source_ids=[...new Set(execution.fills.map(fill=>sourceIdentity('FILL',[fill.source_key])))].sort()
    if(hypurrscan && trade.pnl==null && trade.entry_price!=null && trade.exit_price!=null)trade.pnl=Math.round(((trade.direction==='Long'?trade.exit_price-trade.entry_price:trade.entry_price-trade.exit_price)*trade.size-(trade.fee || 0))*100)/100
    if(!hypurrscan && !Number.isFinite(trade.pnl))throw new Error('An eligible trade has missing or invalid P&L. No trades changed.')
  }
  // Source scope is explicit; an account statement total is not present in these exports.
  parsed.pnlBasis=parsed.pnlBasis || (hypurrscan ? 'Existing reported P&L retained; unmatched trades are estimates' : 'Broker-exported realised P&L; exported fees are shown separately, not subtracted again')
  parsed.audit=importAudit(rows,parsed)
  if(parsed.audit.available && !parsed.audit.matched)parsed.warnings.push('Parsed P&L differs from eligible export totals. Opening-only activity or unsupported rows may account for the difference; review the source before proceeding.')
  return parsed
}
