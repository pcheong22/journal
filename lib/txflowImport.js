// Compare parsed fields only. Re-importing an extended history updates a partial
// position without replacing its journal notes, tags, screenshots or strategy.
export function changedTxFlowTrade(existing, incoming) {
  if (!existing) return true
  // An older export must not roll a position back to an earlier partial close.
  if (Date.parse(incoming.exit_time) < Date.parse(existing.exit_time)) return false
  return Object.entries(incoming).some(([key, value]) => {
    if (key.endsWith('_time')) return Date.parse(existing[key]) !== Date.parse(value)
    if (typeof value === 'number') return existing[key] == null || Math.abs(Number(existing[key]) - value) > 1e-8
    return (existing[key] ?? null) !== value
  })
}
