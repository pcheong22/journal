import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const utils = url(await readFile(new URL('../lib/parserUtils.js', import.meta.url), 'utf8'))
const { parseTxFlow, isTxFlow, txflowAccountId } = await import(url(
  (await readFile(new URL('../lib/parsers/txflow.js', import.meta.url), 'utf8')).replace("'../parserUtils'", JSON.stringify(utils))))
const { changedTxFlowTrade } = await import(url(await readFile(new URL('../lib/txflowImport.js', import.meta.url), 'utf8')))
const wallet = '0x1111111111111111111111111111111111111111'
const header = ['Symbol', 'Side', 'Filled Time', 'Filled Amount', 'Price', 'Trade Value', 'Taker | Maker', 'Fee', 'Closed PnL']
const fill = (side, time, size, price, pnl = 0, fee = 1, symbol = 'ETH') =>
  [symbol, side, `10/20/2026 ${time}`, `${size} ${symbol}`, `${price} USDC`, '100 USDC', 'Taker', `${fee} USDC`, `${pnl} USDC`]
const parse = (fills, address = wallet, tz = 'Asia/Dubai') => parseTxFlow([header, ...fills], 'history.csv', address, tz).trades
const long = [fill('Buy', '12:00:00', 3, 100), fill('Sell', '13:00:00', 1, 110, 10), fill('Sell', '13:01:00', 2, 120, 40)]

test('detects TxFlow headers without confusing native Hyperliquid or other formats', () => {
  assert.ok(isTxFlow([header]))
  assert.ok(isTxFlow([[...header].map((x, i) => i ? x : '\uFEFF' + x)]))
  assert.equal(isTxFlow([['time', 'coin', 'dir', 'px', 'sz']]), false)
  assert.equal(isTxFlow([header.slice(0, -1)]), false)
})

test('requires a wallet and uses a case-insensitive broker-scoped account identity', () => {
  assert.throws(() => txflowAccountId(), /wallet/)
  assert.throws(() => txflowAccountId('invalid'), /wallet/)
  assert.equal(txflowAccountId(wallet), 'TXFLOW_' + wallet)
  const mixed = '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD'
  assert.equal(txflowAccountId(mixed), txflowAccountId(mixed.toLowerCase()))
  assert.notEqual(txflowAccountId(wallet), wallet)
})

test('aggregates fills with weighted prices, closed size and all trading fees', () => {
  const [trade] = parse(long)
  assert.equal(trade.direction, 'Long')
  assert.equal(trade.size, 3)
  assert.equal(trade.entry_price, 100)
  assert.equal(trade.exit_price, 116.66666667)
  assert.equal(trade.pnl, 47)
  assert.equal(trade.fee, 3)
  assert.equal(trade.notional_usd, 300)
  assert.equal(trade.duration_mins, 61)
})

test('converts MM/DD/YYYY local timestamps exactly once and allows UTC', () => {
  const [dubai] = parse(long)
  const [utc] = parse(long, wallet, 'UTC')
  assert.equal(dubai.entry_time, '2026-10-20T08:00:00.000Z')
  assert.equal(utc.entry_time, '2026-10-20T12:00:00.000Z')
})

test('short positions use sells as openings and buys as closes, including losing closes', () => {
  const [trade] = parse([fill('Sell', '12:00:00', 5, 100), fill('Buy', '13:00:00', 5, 110, -50)])
  assert.equal(trade.direction, 'Short')
  assert.equal(trade.pnl, -52)
})

test('IDs are stable across file reordering and unrelated history', () => {
  const [trade] = parse(long)
  assert.equal(parse([...long].reverse())[0].position_id, trade.position_id)
  const unrelated = [fill('Buy', '10:00:00', 1, 100, 0, 1, 'BTC'), fill('Sell', '11:00:00', 1, 110, 10, 1, 'BTC')]
  assert.equal(parse([...unrelated, ...long]).find(t => t.symbol === 'ETH/USD').position_id, trade.position_id)
})

test('partial closes retain identity when a later export completes the trade', () => {
  const [partial] = parse(long.slice(0, 2))
  const [complete] = parse(long)
  assert.equal(partial.position_id, complete.position_id)
  assert.ok(changedTxFlowTrade(partial, complete))
  assert.equal(changedTxFlowTrade(complete, partial), false)
  assert.equal(changedTxFlowTrade({ ...complete, entry_time: '2026-10-20T08:00:00+00:00', notes: 'Keep this' }, complete), false)
})

test('does not collapse distinct identical fills or two separate round trips', () => {
  const doubled = [long[0], long[0], long[1], long[1], long[2], long[2]]
  assert.equal(parse(doubled)[0].size, 6)
  assert.equal(parse(doubled)[0].pnl, 94)
  assert.equal(parse([...long, fill('Buy', '14:00:00', 1, 100), fill('Sell', '15:00:00', 1, 101, 1)]).length, 2)
})

test('supports comma-separated amounts, negative rebates and oil symbol mapping', () => {
  const [trade] = parse([fill('Sell', '12:00:00', '1,000', '1,100', 0, -1, 'CL'), fill('Buy', '13:00:00', '1,000', '1,000', '100,000', 1, 'CL')])
  assert.equal(trade.size, 1000)
  assert.equal(trade.fee, 0)
  assert.equal(trade.pnl, 100000)
  assert.equal(trade.symbol, 'CRUDE')
  assert.equal(trade.tv_symbol, 'NYMEX:CL1!')
})

test('missing openings, invalid rows, currencies and invalid dates fail before import', () => {
  assert.throws(() => parse([long[1]]), /opening fills/)
  const badDate = fill('Buy', '12:00:00', 1, 100); badDate[2] = '02/30/2026 12:00:00'
  const badNumber = fill('Buy', '12:00:00', 'oops', 100)
  const badCurrency = fill('Buy', '12:00:00', 1, 100); badCurrency[4] = '100 USDT'
  for (const row of [badDate, badNumber, badCurrency]) assert.throws(() => parse([row]))
})

test('position flips split fees between the completed and new positions', () => {
  const trades = parse([fill('Buy', '12:00:00', 1, 100, 0, 1), fill('Sell', '13:00:00', 3, 110, 10, 3), fill('Buy', '14:00:00', 2, 100, 20, 2)])
  assert.equal(trades.length, 2)
  assert.equal(trades[0].direction, 'Long')
  assert.equal(trades[0].pnl, 8)
  assert.equal(trades[1].direction, 'Short')
  assert.equal(trades[1].pnl, 16)
  assert.equal(trades.reduce((sum, t) => sum + t.fee, 0), 6)
})

test('scale-ins after partial closes use the remaining-position cost basis', () => {
  const [trade] = parse([fill('Buy', '12:00:00', 10, 100), fill('Sell', '13:00:00', 5, 110, 50), fill('Buy', '14:00:00', 5, 120), fill('Sell', '15:00:00', 10, 120, 100)])
  assert.equal(trade.size, 15)
  assert.equal(trade.entry_price, 106.66666667)
})

test('an opening-only position does not appear as a completed trade', () => {
  assert.equal(parse([long[0]]).length, 0)
})
