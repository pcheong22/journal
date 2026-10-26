import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Load the Next.js ES modules without changing the application's module mode.
const moduleURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const utils = moduleURL(await readFile(new URL('../lib/parserUtils.js', import.meta.url), 'utf8'))
const parser = (await readFile(new URL('../lib/parsers/hyperliquid.js', import.meta.url), 'utf8'))
  .replace("'../parserUtils'", JSON.stringify(utils))
const { parseHyperliquid } = await import(moduleURL(parser))
const { matchesHyperliquidTrade, reconcileHyperliquid } = await import(moduleURL(
  await readFile(new URL('../lib/hyperliquidImport.js', import.meta.url), 'utf8')))
const header = ['time', 'coin', 'dir', 'px', 'sz', 'ntl', 'fee', 'closedPnl']
const rows = [header,
  ['12/05/2026 - 14:00:00', 'COPPER (xyz)', 'Open Long', '6', '10', '60', '.01', '-.01'],
  ['12/05/2026 - 18:00:00', 'COPPER (xyz)', 'Close Long', '7', '10', '70', '.01', '10']]
const parse = (r = rows, tz = 'Asia/Dubai') => parseHyperliquid(r, 'trades.csv', 'account-A', tz).trades
const current = parse()[0]
const utc = parse(rows, 'UTC')[0]
const legacy = (trade, id) => ({ ...trade, id,
  position_id: `HL_COPPERxyz_${Date.parse(trade.exit_time)}_7` })

function database(trades, { tags = [], images = [], failRead = false, failUpdate = false } = {}) {
  const state = { trades: structuredClone(trades), deleted: [], updated: [] }
  return { state, from(table) {
    let operation = 'select', payload, filters = [], start = 0, end = Infinity
    const q = {
      select() { return q },
      single() { return q },
      eq(k, v) { filters.push(row => row[k] === v); return q },
      in(k, values) { filters.push(row => values.includes(row[k])); return q },
      order() { return q },
      range(a, b) { start = a; end = b; return q },
      update(value) { operation = 'update'; payload = value; return q },
      delete() { operation = 'delete'; return q },
      then(resolve, reject) {
        try {
          if (failRead && operation === 'select') return resolve({ error: { message: 'read failed' } })
          if (failUpdate && operation === 'update') return resolve({ error: { message: 'update failed' } })
          const source = table === 'trades' ? state.trades : table === 'trade_tag_mappings' ? tags : images
          const matched = source.filter(row => filters.every(filter => filter(row))).slice(start, end + 1)
          if (operation === 'update') { matched.forEach(row => Object.assign(row, payload)); state.updated.push(...matched) }
          if (operation === 'delete') { state.deleted.push(...matched); state.trades = state.trades.filter(row => !matched.includes(row)) }
          resolve({ data: matched, error: null })
        } catch (error) { reject(error) }
      },
    }
    return q
  } }
}

test('IDs stay stable when unrelated earlier trades change the file order', () => {
  const earlier = [header,
    ['01/05/2026 - 10:00:00', 'BTC', 'Open Long', '100', '1', '100', '0', '0'],
    ['01/05/2026 - 11:00:00', 'BTC', 'Close Long', '101', '1', '101', '0', '1'], ...rows.slice(1)]
  assert.equal(parse(earlier).find(t => t.symbol === 'COPPER/USD').position_id, current.position_id)
  assert.equal(parse([header, ...rows.slice(1).reverse()])[0].position_id, current.position_id)
})

test('legacy UTC and corrected Dubai imports match despite old symbols and indices', () => {
  assert.ok(matchesHyperliquidTrade({ ...legacy(utc, 1), symbol: 'COPPER' }, current, utc))
  assert.ok(matchesHyperliquidTrade(legacy(current, 2), current, utc))
})

test('different account, coin, direction, quantity, P&L and separate times remain separate', () => {
  for (const change of [{ account_id: 'B' }, { position_id: `HL_GOLD_${Date.parse(utc.exit_time)}_7` },
    { direction: 'Short' }, { size: 11 }, { pnl: 11 }, { exit_price: 8 },
    { entry_time: '2026-05-11T14:00:00Z' }, { exit_time: '2026-05-13T18:00:00Z' }]) {
    assert.equal(matchesHyperliquidTrade({ ...legacy(utc, 1), ...change }, current, utc), false)
  }
})

test('reconciles two copies to one corrected row and repeat upload is idempotent', async () => {
  const db = database([legacy(utc, 1), legacy(current, 2)])
  const result = await reconcileHyperliquid(db, [current], [utc])
  assert.equal(result.removed, 1)
  assert.equal(result.newTrades.length, 0)
  assert.equal(db.state.trades.length, 1)
  assert.equal(db.state.trades[0].exit_time, current.exit_time)
  assert.equal(db.state.trades[0].position_id, current.position_id)
  const again = await reconcileHyperliquid(db, [current], [utc])
  assert.equal(again.removed, 0)
  assert.equal(again.newTrades.length, 0)
})

test('keeps the annotated row, its references and enriched entry price', async () => {
  const db = database([legacy(utc, 1), { ...legacy(current, 2), notes: 'Keep me', entry_price: 6.0000001 }],
    { tags: [{ trade_id: 2 }], images: [{ entity_type: 'trade', entity_id: '2' }] })
  await reconcileHyperliquid(db, [current], [utc])
  assert.equal(db.state.trades[0].id, 2)
  assert.equal(db.state.trades[0].notes, 'Keep me')
  assert.equal(db.state.trades[0].entry_price, 6.0000001)
})

test('retains a row referenced only by a screenshot', async () => {
  const db = database([legacy(utc, 1), legacy(current, 2)],
    { images: [{ entity_type: 'trade', entity_id: '2' }] })
  await reconcileHyperliquid(db, [current], [utc])
  assert.equal(db.state.trades[0].id, 2)
})

test('conflicting annotations stop the entire plan before any mutation', async () => {
  const db = database([{ ...legacy(utc, 1), notes: 'A' }, { ...legacy(current, 2), notes: 'B' }])
  await assert.rejects(reconcileHyperliquid(db, [current], [utc]), /separate journal data/)
  assert.equal(db.state.updated.length, 0)
  assert.equal(db.state.deleted.length, 0)
})

test('database failures never become empty results or trigger deletion after failed update', async () => {
  for (const options of [{ failRead: true }, { failUpdate: true }]) {
    const db = database([legacy(utc, 1), legacy(current, 2)], options)
    await assert.rejects(reconcileHyperliquid(db, [current], [utc]), /failed/)
    assert.equal(db.state.deleted.length, 0)
  }
})

test('matches legacy history beyond the first 1,000 account trades', async () => {
  const unrelated = Array.from({ length: 1000 }, (_, i) => ({ ...legacy(current, i + 1), position_id: `OTHER_${i}` }))
  const db = database([...unrelated, legacy(utc, 1001)])
  const result = await reconcileHyperliquid(db, [current], [utc])
  assert.equal(result.newTrades.length, 0)
  assert.equal(result.reconciled, 1)
})

test('does not remove indistinguishable native fill rows without execution IDs', () => {
  const doubled = [header, rows[1], rows[1], rows[2], rows[2]]
  assert.equal(parse(doubled)[0].size, 20)
  assert.equal(parse(doubled)[0].pnl, 20)
})
