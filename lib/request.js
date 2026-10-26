// Keep successful fetch semantics; reject errors before callers update local state.
export async function journalFetch(input, options) {
  if(typeof window!=='undefined'&&window.location?.pathname==='/design-preview')throw new Error('This design preview uses sample data. Open the live journal to save changes.')
  let response
  try { response = await fetch(input, options) }
  catch (cause) {
    if (cause?.name === 'AbortError') throw cause
    const error = new Error('Could not connect. Your changes are still here; please retry.')
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('journal-request-error', { detail:error.message }))
    throw error
  }
  if (!response.ok) {
    let data
    try { data = await response.clone().json() } catch {}
    const error = new Error(data?.error || `Request failed (${response.status}). Please retry.`)
    error.status = response.status
    if (typeof window !== 'undefined' && response.status !== 401) window.dispatchEvent(new CustomEvent('journal-request-error', { detail:error.message }))
    throw error
  }
  return response
}
