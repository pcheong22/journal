import { useState, useEffect, useRef } from 'react'

// Reusable image gallery + uploader for both missed trades and regular trades
// Props: entityType ('missed_trade'|'trade'), entityId (number or temp string), isTempId (bool)
export default function ImageGallery({ entityType, entityId, readOnly = false, isTempId = false }) {
  const [images,     setImages]     = useState([])
  const [loading,    setLoading]    = useState(true)
  const [uploading,  setUploading]  = useState(false)
  const [lightbox,   setLightbox]   = useState(null) // url of expanded image
  const [dragOver,   setDragOver]   = useState(false)
  const fileRef = useRef()

  useEffect(() => {
    if (!entityId) return
    // For temp IDs, don't fetch from server — images are tracked in local state only
    if (isTempId) { setLoading(false); return }
    loadImages()
  }, [entityId, entityType])

  const loadImages = async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/images?entity_type=${entityType}&entity_id=${entityId}`)
      const data = await res.json()
      setImages(data.images || [])
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  const uploadFiles = async (files) => {
    if (!files?.length || !entityId) return
    setUploading(true)
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      const form = new FormData()
      form.append('file', file)
      form.append('entity_type', entityType)
      form.append('entity_id', String(entityId))
      try {
        const res  = await fetch('/api/images', { method: 'POST', body: form })
        const data = await res.json()
        if (data.image) setImages(prev => [...prev, data.image])
      } catch(e) { console.error('Upload failed:', e) }
    }
    setUploading(false)
  }

  const deleteImage = async (img) => {
    if (!confirm('Delete this image?')) return
    try {
      await fetch(`/api/images?id=${img.id}&entity_type=${entityType}&entity_id=${entityId}&filename=${img.filename}`, { method: 'DELETE' })
      setImages(prev => prev.filter(i => i.id !== img.id))
      if (lightbox === img.url) setLightbox(null)
    } catch(e) { console.error(e) }
  }

  const handleDrop = e => {
    e.preventDefault(); setDragOver(false)
    uploadFiles(e.dataTransfer.files)
  }

  if (!entityId) return (
    <div style={{color:'var(--mu)',fontSize:12,padding:'12px 0'}}>Save the trade first to attach images.</div>
  )

  return (
    <div>
      {/* Upload zone — hidden when readOnly */}
      {!readOnly && (
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            border: `2px dashed ${dragOver ? 'var(--ac)' : 'var(--bd)'}`,
            borderRadius: 8, padding: '14px 18px', marginBottom: 14,
            background: dragOver ? 'var(--ac-bg)' : 'var(--sf2)',
            cursor: 'pointer', transition: 'all .15s',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
          <span style={{ fontSize: 20 }}>{uploading ? '⏳' : '🖼️'}</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx)' }}>
              {uploading ? 'Uploading…' : 'Attach screenshots'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--mu)' }}>
              Drag & drop or click · multiple images · PNG, JPG, WEBP · max 10MB each
            </div>
          </div>
          {uploading && (
            <span style={{ marginLeft: 'auto', width: 16, height: 16, border: '2px solid var(--bd2)', borderTop: '2px solid var(--ac)', borderRadius: '50%', display: 'inline-block', animation: 'spin 1s linear infinite' }} />
          )}
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
        onChange={e => uploadFiles(e.target.files)} />

      {/* Loading state */}
      {loading && (
        <div style={{ color: 'var(--mu)', fontSize: 12, padding: '8px 0' }}>Loading images…</div>
      )}

      {/* Empty state */}
      {!loading && images.length === 0 && (
        <div style={{ color: 'var(--mu)', fontSize: 12, padding: '8px 0' }}>
          {readOnly ? 'No images attached.' : isTempId ? 'No screenshots yet — drag & drop or click above to attach.' : 'No images attached yet. Upload chart screenshots above.'}
        </div>
      )}

      {/* Thumbnail grid */}
      {images.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
          {images.map(img => (
            <div key={img.id} style={{ position: 'relative', borderRadius: 7, overflow: 'hidden', border: '1px solid var(--bd)', background: 'var(--sf3)', aspectRatio: '4/3' }}>
              <img
                src={img.url}
                alt={img.filename}
                onClick={() => setLightbox(img.url)}
                style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer', display: 'block', transition: 'opacity .15s' }}
                onMouseEnter={e => e.target.style.opacity = '.8'}
                onMouseLeave={e => e.target.style.opacity = '1'}
              />
              {!readOnly && (
                <button
                  onClick={() => deleteImage(img)}
                  style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.7)', color: '#fff', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.92)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <img src={lightbox} alt="Screenshot" style={{ maxWidth: '100%', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8, boxShadow: '0 0 60px rgba(0,0,0,.5)' }} />
          <button onClick={() => setLightbox(null)}
            style={{ position: 'absolute', top: 20, right: 24, background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', fontSize: 20, width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
