export const NOTE_FIELDS = ['notes','note_entry_reason','note_management','note_lessons','note_emotional_state']
export function riskMultiple(trade, stop = trade.stop_loss) {
  if (stop == null || stop === '' || trade.entry_price == null || trade.exit_price == null) return null
  const ep = Number(trade.entry_price), xp = Number(trade.exit_price), sl = Number(stop)
  if (![ep,xp,sl].every(Number.isFinite) || ep <= 0 || xp <= 0 || sl <= 0 || !['Long','Short'].includes(trade.direction)) return null
  const risk = trade.direction === 'Long' ? ep - sl : sl - ep
  const reward = trade.direction === 'Long' ? xp - ep : ep - xp
  if (risk <= 0) return null
  const value = reward / risk
  return Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100
}
export function noteRequest(body) {
  const fail = message => { throw Object.assign(new Error(message), { status:400 }) }
  if (!Number.isSafeInteger(body?.tradeId) || body.tradeId < 1) fail('Invalid trade ID.')
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) fail('Reload this trade before saving; its saved version is missing.')
  const patch = {}
  for (const field of NOTE_FIELDS) if (Object.hasOwn(body, field)) {
    if (body[field] !== null && (typeof body[field] !== 'string' || body[field].length > 20000)) fail('Notes must be text, with at most 20,000 characters per field.')
    patch[field] = body[field]
  }
  if (Object.hasOwn(body, 'stop_loss')) {
    if (body.stop_loss !== null && (typeof body.stop_loss !== 'number' || !Number.isFinite(body.stop_loss) || body.stop_loss <= 0)) fail('Enter a positive stop price, or clear it.')
    patch.stop_loss = body.stop_loss
  }
  let tagIds = null
  if (Object.hasOwn(body, 'tagIds')) {
    if (!Array.isArray(body.tagIds) || body.tagIds.length > 200 || body.tagIds.some(id => !Number.isSafeInteger(id) || id < 1)) fail('Invalid tag selection.')
    tagIds = [...new Set(body.tagIds)]
  }
  return { p_trade_id: body.tradeId, p_patch: patch, p_tag_ids: tagIds, p_expected_revision: body.expectedRevision }
}
