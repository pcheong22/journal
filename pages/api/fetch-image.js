import { createClient } from '@supabase/supabase-js'
import { requireOwner } from '../../lib/serverAuth'
import { tradingViewImage } from '../../lib/accessPolicy'
import { checkImageEntity, saveImage } from '../../lib/privateImages'
import { uploadError } from '../../lib/uploadSafety'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

export default async function handler(req, res) {
  if (!await requireOwner(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const { url, entity_type, entity_id } = req.body || {}
    if (typeof url !== 'string' || url.length > 300) throw uploadError('Use a TradingView snapshot link.')
    let imageUrl
    try { imageUrl = tradingViewImage(url.trim()) } catch (error) { throw uploadError(error.message) }
    const id = await checkImageEntity(supabase, entity_type, entity_id)
    // Only a fixed vendor hostname and snapshot path are fetched. Redirects are never followed.
    const response = await fetch(imageUrl, { redirect: 'error', signal: controller.signal, headers: { Accept: 'image/png' } })
    if (!response.ok || !response.body) throw uploadError('Could not fetch this TradingView snapshot.')
    const limit = 10 * 1024 * 1024
    if (Number(response.headers.get('content-length')) > limit) throw uploadError('Screenshot must be under 10 MB.', 413)
    const chunks = []; let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > limit) { controller.abort(); throw uploadError('Screenshot must be under 10 MB.', 413) }
      chunks.push(chunk)
    }
    return res.status(200).json({ image: await saveImage(supabase, entity_type, id, Buffer.concat(chunks)) })
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.status ? error.message : 'Could not fetch snapshot. Check the link or upload the screenshot as a file.' })
  } finally { clearTimeout(timer); controller.abort() }
}
