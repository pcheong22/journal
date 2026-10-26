import { createClient } from '@supabase/supabase-js'
import { requireOwner } from '../../lib/serverAuth'
import { multipart } from '../../lib/uploadSafety'
import { checkImageEntity, publicImage, saveImage, removeImage } from '../../lib/privateImages'
import { imageLocation } from '../../lib/accessPolicy'
export const config = { api: { bodyParser: false, responseLimit: '11mb' } }
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

export default async function handler(req, res) {
  if (!await requireOwner(req, res)) return
  try {
    if (req.method === 'GET' && req.query.image) {
      if ((typeof req.query.image !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(req.query.image))) return res.status(400).json({ error: 'Invalid image ID.' })
      const { data, error } = await supabase.from('trade_images').select('*').eq('id', req.query.image).maybeSingle()
      if (error) throw new Error('Could not load screenshot.')
      if (!data) return res.status(404).end()
      const path = imageLocation(data, process.env.NEXT_PUBLIC_SUPABASE_URL)
      const { data: blob, error: downloadError } = await supabase.storage.from('trade-images').download(path)
      if (downloadError) throw new Error('Could not load screenshot.')
      if (blob.size > 10 * 1024 * 1024) return res.status(413).end()
      const buffer = Buffer.from(await blob.arrayBuffer())
      // Legacy attachments receive the same file validation as new uploads.
      const { inspectImage } = await import('../../lib/uploadSafety')
      const { contentType } = inspectImage(buffer)
      res.setHeader('Content-Type', contentType)
      res.setHeader('Content-Disposition', 'inline')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      return res.status(200).send(buffer)
    }
    if (req.method === 'GET') {
      const { entity_type, entity_id } = req.query
      await checkImageEntity(supabase, entity_type, entity_id)
      const { data, error } = await supabase.from('trade_images').select('*').eq('entity_type', entity_type).eq('entity_id', String(entity_id)).order('created_at', { ascending: true })
      if (error) throw new Error('Could not load screenshots.')
      return res.status(200).json({ images: (data || []).map(publicImage) })
    }
    if (req.method === 'POST') {
      const { file, entity_type, entity_id } = await multipart(req, 10 * 1024 * 1024)
      const id = await checkImageEntity(supabase, entity_type, entity_id)
      return res.status(200).json({ image: await saveImage(supabase, entity_type, id, file.buffer) })
    }
    if (req.method === 'DELETE') {
      if ((typeof req.query.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(req.query.id))) return res.status(400).json({ error: 'Invalid image ID.' })
      const { data, error } = await supabase.from('trade_images').select('*').eq('id', req.query.id).maybeSingle()
      if (error) throw new Error('Could not find screenshot.')
      if (!data) return res.status(404).json({ error: 'Screenshot not found.' })
      await removeImage(supabase, data)
      return res.status(200).json({ ok: true })
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) { return res.status(error.status || 503).json({ error: error.message || 'Screenshot operation failed.' }) }
}
