// Execution records are private, immutable snapshots. A database trade ID links
// a record to its journal row; no notes/strategy fields are rewritten on backfill.
import { createHash } from 'crypto'
import { executionView } from './executionUtils'
export const EXECUTION_BUCKET = 'trade-executions'
const folder = account => createHash('sha256').update(account).digest('hex')
const missing = error => ['404', 'not_found', 'NoSuchKey', 'NoSuchBucket'].includes(String(error?.statusCode || error?.code)) || /not found|does not exist/i.test(error?.message || '')
let ready = false
export async function ensureExecutionStore(supabase) {
  if (ready) return
  const { data, error } = await supabase.storage.getBucket(EXECUTION_BUCKET)
  if (error && !missing(error)) throw new Error(`Execution storage: ${error.message}`)
  if (data?.public) throw new Error('Execution storage must be private.')
  if (!data) {
    const result = await supabase.storage.createBucket(EXECUTION_BUCKET, { public: false, fileSizeLimit: 10 * 1024 * 1024, allowedMimeTypes: ['application/json'] })
    if (result.error && !/already exists|duplicate/i.test(result.error.message)) throw new Error(`Execution storage: ${result.error.message}`)
  }
  ready = true
}

export async function executionIndex(supabase, accountId) {
  const index = {}
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(EXECUTION_BUCKET).list(folder(accountId),
      { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) {
      if (missing(error)) return index
      throw new Error(`Execution storage: ${error.message}`)
    }
    for (const file of data || []) {
      const match = file.name.match(/^(\d+)_(\d+)_(\d+)_([a-f0-9]{64})\.json$/)
      if (!match) continue
      const [, id, timestamp, count] = match
      const candidate = { id: Number(id), last_time: Number(timestamp), count: Number(count), saved_at: Date.parse(file.created_at || file.updated_at) || 0, path: `${folder(accountId)}/${file.name}` }
      const current = index[id]
      // An older/shorter history cannot hide a more complete execution record.
      if (!current || candidate.last_time > current.last_time || (candidate.last_time === current.last_time &&
        (candidate.count > current.count || (candidate.count === current.count && candidate.saved_at > current.saved_at)))) index[id] = candidate
    }
    if (!data || data.length < 1000) break
  }
  return index
}

export async function saveExecutionRecords(supabase, parsed, filename, timezone) {
  if (!parsed.executions?.length) return 0
  await ensureExecutionStore(supabase)
  let saved = 0
  for (const details of parsed.executions) {
    const { data: trade, error } = await supabase.from('trades').select('id,account_id,position_id,broker,entry_time,exit_time,size,pnl,fee,entry_price,exit_price')
      .eq('account_id', parsed.accountId).eq('position_id', details.position_id).single()
    if (error) throw new Error(`Cannot attach execution details: ${error.message}`)
    if (Date.parse(trade.exit_time) > Math.max(...details.fills.map(fill => Date.parse(fill.time)))) continue
    const view = executionView(details.fills)
    const record = { version: 1, account_id: trade.account_id, trade_id: trade.id, position_id: trade.position_id,
      broker: trade.broker, source: { filename, timezone }, summary: trade,
      pnl_basis: details.pnl_basis, fills: details.fills,
      coverage: view.complete ? 'complete' : 'missing_opening_fills' }
    const body = JSON.stringify(record)
    const hash = createHash('sha256').update(body).digest('hex')
    const last = Math.max(...details.fills.map(fill => Date.parse(fill.time)))
    const path = `${folder(trade.account_id)}/${trade.id}_${last}_${details.fills.length}_${hash}.json`
    const { error: writeError } = await supabase.storage.from(EXECUTION_BUCKET).upload(path, body,
      { contentType: 'application/json', cacheControl: '0', upsert: false })
    if (writeError && !/already exists|duplicate/i.test(writeError.message)) throw new Error(`Saving execution details: ${writeError.message}`)
    saved += details.fills.length
  }
  return saved
}

export async function readExecutionRecord(supabase, trade) {
  const index = await executionIndex(supabase, trade.account_id)
  const entry = index[trade.id]
  if (!entry) return null
  const { data, error } = await supabase.storage.from(EXECUTION_BUCKET).download(entry.path)
  if (error) throw new Error(`Loading execution details: ${error.message}`)
  const record = JSON.parse(await data.text())
  if (String(record.trade_id) !== String(trade.id) || record.account_id !== trade.account_id || record.position_id !== trade.position_id) throw new Error('Execution record does not match this trade.')
  return record
}
