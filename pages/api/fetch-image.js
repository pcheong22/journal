// pages/api/fetch-image.js
// Downloads an image from a URL (e.g. TradingView snapshot) and stores it in Supabase Storage
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// Resolve TradingView short URLs to direct image URLs
function resolveImageUrl(url) {
  url = url.trim()
  // tradingview.com/x/{id} → s3.tradingview.com/snapshots/{first_letter}/{id}.png
  const tvMatch = url.match(/tradingview\.com\/x\/([A-Za-z0-9]+)\/?$/)
  if (tvMatch) {
    const id     = tvMatch[1]
    const letter = id[0].toLowerCase()
    return `https://s3.tradingview.com/snapshots/${letter}/${id}.png`
  }
  // Already a direct image URL — return as-is
  return url
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { url, entity_type, entity_id } = req.body
  if (!url || !entity_type || !entity_id) {
    return res.status(400).json({ error: 'url, entity_type, and entity_id required' })
  }

  const imageUrl = resolveImageUrl(url)

  try {
    // Fetch the image server-side (avoids CORS issues)
    const fetchRes = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TradeIntel/1.0)',
        'Accept': 'image/*,*/*',
        'Referer': 'https://www.tradingview.com/',
      }
    })

    if (!fetchRes.ok) {
      return res.status(400).json({
        error: `Could not fetch image from URL (status ${fetchRes.status}). Check the URL is a valid TradingView snapshot link.`
      })
    }

    const contentType = fetchRes.headers.get('content-type') || 'image/png'
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'URL does not point to an image file.' })
    }

    // Read image bytes
    const arrayBuffer = await fetchRes.arrayBuffer()
    const buffer      = Buffer.from(arrayBuffer)

    // Determine extension from content type
    const ext = contentType.includes('jpeg') ? 'jpg'
      : contentType.includes('png')  ? 'png'
      : contentType.includes('webp') ? 'webp'
      : contentType.includes('gif')  ? 'gif'
      : 'png'

    const safeName    = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
    const folder      = entity_type === 'missed_trade' ? 'missed' : 'trades'
    const storagePath = `${folder}/${entity_id}/${safeName}`

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('trade-images')
      .upload(storagePath, buffer, { contentType, upsert: false })

    if (uploadError) return res.status(500).json({ error: uploadError.message })

    const { data: { publicUrl } } = supabase.storage
      .from('trade-images')
      .getPublicUrl(storagePath)

    // Save record to trade_images table
    const { data: imageRecord, error: dbError } = await supabase
      .from('trade_images')
      .insert([{ entity_type, entity_id: String(entity_id), url: publicUrl, filename: safeName }])
      .select()
      .single()

    if (dbError) return res.status(500).json({ error: dbError.message })

    return res.status(200).json({ image: imageRecord })

  } catch (err) {
    console.error('fetch-image error:', err)
    return res.status(500).json({ error: err.message || 'Failed to fetch image from URL' })
  }
}
