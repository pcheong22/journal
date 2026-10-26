// Shared by importers and the UI. Never infer order IDs from timestamps.
export function allocateExecution(fill, fraction) {
  return { ...fill, quantity: fill.quantity * fraction, fee: fill.fee * fraction,
    reported_pnl: fill.reported_pnl * fraction, allocated: fill.allocated || fraction !== 1 }
}

export function combineExecutions(fills) {
  const bySource = new Map()
  for (const fill of fills) {
    const key = `${fill.source_key}|${fill.action}`
    if (!bySource.has(key)) bySource.set(key, { ...fill })
    else {
      const existing = bySource.get(key)
      existing.quantity += fill.quantity
      existing.fee += fill.fee
      existing.reported_pnl += fill.reported_pnl
    }
  }
  return [...bySource.values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || a.sequence - b.sequence)
}

export function executionView(fills) {
  let remaining = 0, average = null, complete = true, realisedCost = 0, closedQuantity = 0
  const rows = fills.map((fill, index) => {
    const before = remaining
    if (fill.action === 'open') {
      average = before > 1e-8 && average != null
        ? (average * before + fill.price * fill.quantity) / (before + fill.quantity) : fill.price
      remaining += fill.quantity
    } else {
      if (remaining + 1e-6 < fill.quantity || average == null) complete = false
      if (average != null && remaining + 1e-6 >= fill.quantity) {
        realisedCost += average * fill.quantity
        closedQuantity += fill.quantity
      }
      remaining = Math.max(0, remaining - fill.quantity)
      if (remaining < 1e-7) { remaining = 0; average = null }
    }
    const label = fill.action === 'open' ? (before < 1e-7 ? 'Entry' : 'Add') : (remaining === 0 ? 'Exit' : 'Reduce')
    return { ...fill, index, label, remaining, average_cost: average }
  })
  const batches = []
  for (const fill of rows) {
    const key = `${fill.action}|${fill.side}|${fill.order_id ? 'order:' + fill.order_id : 'time:' + fill.time}`
    let batch = batches[batches.length - 1]
    if (!batch || batch.key !== key) {
      batch = { key, time: fill.time, grouping: fill.order_id ? 'order' : 'timestamp', order_id: fill.order_id || null,
        action: fill.action, label: fill.label, quantity: 0, value: 0, fee: 0, reported_pnl: 0, fills: [] }
      batches.push(batch)
    }
    batch.quantity += fill.quantity
    batch.value += fill.quantity * fill.price
    batch.fee += fill.fee
    batch.reported_pnl += fill.reported_pnl
    batch.fills.push(fill)
    batch.remaining = fill.remaining
    batch.average_cost = fill.average_cost
    batch.price = batch.value / batch.quantity
    if (fill.label === 'Exit') batch.label = 'Exit'
  }
  const opens = rows.filter(fill => fill.action === 'open'), closes = rows.filter(fill => fill.action === 'close')
  const weighted = group => {
    const quantity = group.reduce((sum, fill) => sum + fill.quantity, 0)
    return quantity ? group.reduce((sum, fill) => sum + fill.quantity * fill.price, 0) / quantity : null
  }
  return { rows, batches, complete, remaining, average_cost: average,
    average_entry: weighted(opens), average_exit: weighted(closes),
    realised_average_cost: complete && closedQuantity ? realisedCost / closedQuantity : null,
    entry_count: opens.length, exit_count: closes.length,
    fees: rows.reduce((sum, fill) => sum + fill.fee, 0),
    reported_close_pnl: closes.reduce((sum, fill) => sum + fill.reported_pnl, 0) }
}
