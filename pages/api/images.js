// pages/api/images.js
import { createClient } from '@supabase/supabase-js'

export const config = { api: { bodyParser: false } }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {

  // ── GET — list images for an entity ──────────────────────────────────────
  if (req.method === 'GET') {
    const { entity_type, entity_id } = req.query
    if (!entity_type || !entity_id) return res.status(400).json({ error: 'entity_type and entity_id required' })
    const { data, error } = await supabase
      .from('trade_images')
      .select('*')
      .eq('entity_type', entity_type)
      .eq('entity_id', String(entity_id))
      .order('created_at', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ images: data || [] })
  }

  // ── POST — upload image ───────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const buffer = Buffer.concat(chunks)

      const contentType   = req.headers['content-type'] || ''
      const boundaryMatch = contentType.match(/boundary=(.+)$/)
      if (!boundaryMatch) return res.status(400).json({ error: 'No boundary in content-type' })

      const boundary = '--' + boundaryMatch[1]
      const parts    = buffer.toString('binary').split(boundary)

      let fileBuffer  = null
      let filename    = 'image.jpg'
      let mimeType    = 'image/jpeg'
      let entity_type = null
      let entity_id   = null

      for (const part of parts) {
        if (!part.includes('Content-Disposition')) continue
        const headerEnd = part.indexOf('\r\n\r\n')
        if (headerEnd < 0) continue
        const headers  = part.slice(0, headerEnd)
        const bodyBin  = part.slice(headerEnd + 4, part.lastIndexOf('\r\n'))
        const nameMatch = headers.match(/name="([^"]+)"/)
        const fieldName = nameMatch?.[1]

        if (headers.includes('filename=')) {
          const fnMatch = headers.match(/filename="([^"]+)"/)
          if (fnMatch) filename = fnMatch[1]
          const ctMatch = headers.match(/Content-Type:\s*([^\r\n]+)/)
          if (ctMatch) mimeType = ctMatch[1].trim()
          fileBuffer = Buffer.from(bodyBin, 'binary')
        } else if (fieldName === 'entity_type') {
          entity_type = bodyBin.trim()
        } else if (fieldName === 'entity_id') {
          entity_id = bodyBin.trim()
        }
      }

      if (!fileBuffer || !entity_type || !entity_id) {
        return res.status(400).json({ error: 'entity_type, entity_id, and file required' })
      }

      const ext         = filename.split('.').pop().toLowerCase() || 'jpg'
      const safeName    = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
      const folder      = entity_type === 'missed_trade' ? 'missed' : 'trades'
      const storagePath = `${folder}/${entity_id}/${safeName}`

      const { error: uploadError } = await supabase.storage
        .from('trade-images')
        .upload(storagePath, fileBuffer, { contentType: mimeType, upsert: false })

      if (uploadError) return res.status(500).json({ error: uploadError.message })

      const { data: { publicUrl } } = supabase.storage
        .from('trade-images')
        .getPublicUrl(storagePath)

      const { data: imageRecord, error: dbError } = await supabase
        .from('trade_images')
        .insert([{ entity_type, entity_id: entity_id, url: publicUrl, filename: safeName }])
        .select()
        .single()

      if (dbError) return res.status(500).json({ error: dbError.message })
      return res.status(200).json({ image: imageRecord })

    } catch (err) {
      console.error('Image upload error:', err)
      return res.status(500).json({ error: err.message || 'Upload failed' })
    }
  }

  // ── DELETE — delete image ─────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { id, entity_type, entity_id, filename } = req.query
    if (!id || !entity_type || !entity_id || !filename) {
      return res.status(400).json({ error: 'id, entity_type, entity_id, filename required' })
    }
    const folder      = entity_type === 'missed_trade' ? 'missed' : 'trades'
    const storagePath = `${folder}/${entity_id}/${filename}`
    await supabase.storage.from('trade-images').remove([storagePath])
    const { error } = await supabase.from('trade_images').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
