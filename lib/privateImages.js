import { randomUUID } from 'node:crypto'
import { inspectImage, uploadError } from './uploadSafety'
import { imageLocation } from './accessPolicy'

export const publicImage = record => ({ ...record, url: `/api/images?image=${encodeURIComponent(record.id)}` })

export async function checkImageEntity(client, type, id) {
  id = String(id || '')
  if (!['trade', 'missed_trade'].includes(type) || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw uploadError('Invalid screenshot destination.')
  // Unsaved missed trades use a browser-generated temporary ID, then re-link on save.
  if (type === 'missed_trade' && /^temp_\d{10,16}_[a-z0-9]{1,20}$/.test(id)) return id
  if (!/^[1-9]\d{0,15}$/.test(id)) throw uploadError('Save the trade before attaching screenshots.')
  const { data, error } = await client.from(type === 'trade' ? 'trades' : 'missed_trades').select('id').eq('id', id).maybeSingle()
  if (error) throw uploadError('Could not check screenshot destination.', 503)
  if (!data) throw uploadError('Trade not found.', 404)
  return id
}

export async function saveImage(client, type, id, buffer) {
  const { ext, contentType } = inspectImage(buffer)
  const filename = `${randomUUID()}.${ext}`
  const storagePath = `${type === 'missed_trade' ? 'missed' : 'trades'}/${id}/${filename}`
  const bucket = client.storage.from('trade-images')
  const { error } = await bucket.upload(storagePath, buffer, { contentType, upsert: false })
  if (error) throw uploadError('Could not save screenshot.', 503)
  // Keep the historical canonical URL as a storage locator, never return it to a browser.
  const { data: { publicUrl } } = bucket.getPublicUrl(storagePath)
  const { data, error: dbError } = await client.from('trade_images').insert({ entity_type: type, entity_id: id, filename, url: publicUrl }).select().single()
  if (dbError) { await bucket.remove([storagePath]); throw uploadError('Could not save screenshot record.', 503) }
  return publicImage(data)
}

export async function removeImage(client, record) {
  const path = imageLocation(record, process.env.NEXT_PUBLIC_SUPABASE_URL)
  const { error: storageError } = await client.storage.from('trade-images').remove([path])
  if (storageError) throw uploadError('Could not delete screenshot.', 503)
  const { error } = await client.from('trade_images').delete().eq('id', record.id)
  if (error) throw uploadError('Could not delete screenshot record.', 503)
}
