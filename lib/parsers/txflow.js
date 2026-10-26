// TxFlow all-history CSVs contain fills, not positions. Reconstruct each
// one-way position chronologically, including scale-ins, reductions and flips.
import { getSession, getTvSymbol, normaliseSymbol } from '../parserUtils'

const REQUIRED = ['Symbol', 'Side', 'Filled Time', 'Filled Amount', 'Price', 'Trade Value', 'Taker | Maker', 'Fee', 'Closed PnL']
const clean = value => String(value ?? '').replace(/^\uFEFF/, '').trim()
export const isTxFlow = rows => rows.slice(0, 3).some(row => REQUIRED.every(name => row.map(clean).includes(name)))
export const txflowAccountId = wallet => {
  if (typeof wallet !== 'string' || !/^0x[\da-f]{40}$/i.test(wallet)) throw new Error('Choose a valid TxFlow wallet address before importing.')
  // Wallets can be used at other exchanges. Accounts must remain broker-scoped.
  return `TXFLOW_${wallet.toLowerCase()}`
}

function number(value) {
  const text = clean(value).replace(/,/g, '').replace(/\s+[A-Za-z][\w/]*$/, '')
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw new Error(`Invalid TxFlow number: ${value}`)
  const result = Number(text)
  if (!Number.isFinite(result)) throw new Error('Invalid TxFlow numeric value')
  return result
}

function date(value, timezone) {
  const match = clean(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})$/)
  if (!match) throw new Error(`Invalid TxFlow timestamp: ${value}`)
  const [, month, day, year, hour, minute, second] = match.map(Number)
  const ref = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (ref.getUTCMonth() !== month - 1 || ref.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) {
    throw new Error(`Invalid TxFlow timestamp: ${value}`)
  }
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(ref)
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]))
  const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ref.getTime()
  return new Date(ref.getTime() - offset)
}

export function parseTxFlow(rows, filename, wallet, timezone = 'Asia/Dubai') {
  const accountId = txflowAccountId(wallet)
  const headerIndex = rows.findIndex(row => REQUIRED.every(name => row.map(clean).includes(name)))
  if (headerIndex < 0) throw new Error('Unrecognised TxFlow CSV header')
  const header = rows[headerIndex].map(clean)
  const at = name => header.indexOf(name)
  const sourceOccurrences = new Map()
  const fills = rows.slice(headerIndex + 1).filter(row => row.some(value => clean(value))).map((row, index) => {
    const symbol = clean(row[at('Symbol')])
    const side = clean(row[at('Side')]).toLowerCase()
    const size = number(row[at('Filled Amount')])
    const price = number(row[at('Price')])
    const pnl = number(row[at('Closed PnL')])
    const fee = number(row[at('Fee')]) // Keep rebates negative.
    if (!symbol || !['buy', 'sell'].includes(side) || size <= 0 || price <= 0) throw new Error(`Invalid TxFlow fill on row ${index + headerIndex + 2}`)
    if ([at('Price'), at('Fee'), at('Closed PnL'), at('Trade Value')].some(i => !/\sUSDC$/.test(clean(row[i])))) {
      throw new Error('Only USDC-settled TxFlow fills are supported.')
    }
    const time = date(row[at('Filled Time')], timezone || 'Asia/Dubai')
    const source = JSON.stringify(row)
    const occurrence = sourceOccurrences.get(source) || 0
    sourceOccurrences.set(source, occurrence + 1)
    return { symbol, sign: side === 'buy' ? 1 : -1, size, price, pnl, fee, time,
      execution: { source_key: `${source}|${occurrence}`, sequence: index, source_row: row,
        source_row_number: index + headerIndex + 2, source_time: row[at('Filled Time')], time: time.toISOString(),
        side: side === 'buy' ? 'Buy' : 'Sell', quantity: size, price, fee, reported_pnl: pnl,
        liquidity: clean(row[at('Taker | Maker')]) } }
  })
  // Native exports are newest first; reversing also restores sequence for ties.
  if (fills.length > 1 && fills[0].time > fills[fills.length - 1].time) fills.reverse()
  fills.sort((a, b) => a.time - b.time)
  const positions = new Map(), trades = [], executions = [], occurrences = new Map()
  const round = (n, places = 8) => Math.round((n + Number.EPSILON) * 10 ** places) / 10 ** places
  const emit = position => {
    if (!position.closedSize) return
    const direction = position.sign === 1 ? 'Long' : 'Short'
    const symbol = position.symbol === 'CL' ? 'CRUDE' : normaliseSymbol(position.symbol)
    const entryPrice = position.closedEntryValue / position.closedSize
    const exitPrice = position.exitValue / position.closedSize
    const pnl = round(position.pnl - position.fee, 2)
    trades.push({ position_id: position.id, account_id: accountId, broker: 'TxFlow',
      entry_time: position.start.toISOString(), exit_time: position.end.toISOString(), symbol, direction,
      size: round(position.closedSize), entry_price: round(entryPrice), exit_price: round(exitPrice),
      notional_usd: round(entryPrice * position.closedSize, 2), notional_method: 'price_x_size',
      pnl, pct_gain: null, fee: round(position.fee, 8),
      duration_mins: round((position.end - position.start) / 60000, 1), currency: 'USDC',
      session: getSession(position.end.getUTCHours()),
      day_of_week: position.end.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
      tv_symbol: getTvSymbol(symbol), raw_direction: direction, order_type: 'TRADE' })
    executions.push({ position_id: position.id, fills: position.fills,
      pnl_basis: 'Closed PnL less all exported trading fees. Funding is not included.' })
  }
  const open = (fill, size, fee) => {
    const key = `${encodeURIComponent(fill.symbol)}_${fill.sign}_${fill.time.getTime()}`
    const occurrence = occurrences.get(key) || 0
    occurrences.set(key, occurrence + 1)
    const position = { symbol: fill.symbol, sign: fill.sign, start: fill.time, remaining: size,
      openSize: size, averageEntry: fill.price, closedEntryValue: 0, closedSize: 0, exitValue: 0, pnl: 0, fee,
      fills: [{ ...fill.execution, action: 'open', quantity: size, fee, reported_pnl: 0,
        allocated: size !== fill.size }],
      // Opening identity stays stable as later fills/partial closes are added.
      id: `TXF_${key}_${occurrence}` }
    positions.set(fill.symbol, position)
    return position
  }
  for (const fill of fills) {
    let position = positions.get(fill.symbol)
    if (!position) {
      if (fill.pnl !== 0) throw new Error(`TxFlow ${fill.symbol}: opening fills are missing. Export the complete trade history.`)
      open(fill, fill.size, fill.fee)
      continue
    }
    if (position.sign === fill.sign) {
      if (fill.pnl !== 0) throw new Error(`TxFlow ${fill.symbol}: history is incomplete or uses unsupported hedge mode.`)
      position.averageEntry = (position.averageEntry * position.remaining + fill.price * fill.size) / (position.remaining + fill.size)
      position.remaining += fill.size
      position.openSize += fill.size
      position.fee += fill.fee
      position.fills.push({ ...fill.execution, action: 'open' })
      continue
    }
    const closed = Math.min(fill.size, position.remaining)
    position.closedSize += closed
    position.closedEntryValue += position.averageEntry * closed
    position.exitValue += fill.price * closed
    position.pnl += fill.pnl
    position.fee += fill.fee * closed / fill.size
    position.fills.push({ ...fill.execution, action: 'close', quantity: closed,
      fee: fill.fee * closed / fill.size, allocated: closed !== fill.size })
    position.end = fill.time
    position.remaining -= closed
    const residual = fill.size - closed
    const tolerance = Math.max(1e-8, position.openSize * 1e-12)
    if (position.remaining <= tolerance) {
      emit(position)
      positions.delete(fill.symbol)
      if (residual > tolerance) open(fill, residual, fill.fee * residual / fill.size)
    }
  }
  for (const position of positions.values()) emit(position)
  return { broker: 'TxFlow', accountId, currency: 'USDC', trades, executions,
    // Funding is not present in the trade-history export.
    pnlBasis: 'Closed PnL less exported trading fees; funding excluded' }
}
