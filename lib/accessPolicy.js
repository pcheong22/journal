// Pure policy shared by the server guard and its tests. Configuration fails closed.
export function ownerAllowed(user, ownerEmail) {
  return Boolean(ownerEmail && user?.email_confirmed_at && user?.email &&
    user.email.toLowerCase() === ownerEmail.trim().toLowerCase())
}

export function trustedMutation(req, appUrl) {
  if (req.headers['x-journal-request'] !== '1' || !appUrl) return false
  try {
    return new URL(req.headers.origin).origin === new URL(appUrl).origin
  } catch { return false }
}

export function imageLocation(record, supabaseUrl) {
  const url = new URL(record.url)
  const base = new URL(supabaseUrl)
  const prefix = '/storage/v1/object/public/trade-images/'
  if (url.origin !== base.origin || !url.pathname.startsWith(prefix)) throw new Error('Invalid stored image path')
  const path = decodeURIComponent(url.pathname.slice(prefix.length))
  if (!/^(trades|missed)\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(path) || path.includes('..')) throw new Error('Invalid stored image path')
  return path
}

export function tradingViewImage(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) throw new Error('Use a TradingView snapshot link')
  const short = url.pathname.match(/^\/x\/([A-Za-z0-9]{1,80})\/?$/)
  if (['www.tradingview.com', 'tradingview.com'].includes(url.hostname) && short) {
    const id = short[1]
    return `https://s3.tradingview.com/snapshots/${id[0].toLowerCase()}/${id}.png`
  }
  if (url.hostname === 's3.tradingview.com' && /^\/snapshots\/[a-z0-9]\/[A-Za-z0-9]{1,80}\.png$/.test(url.pathname)) return url.href
  throw new Error('Use a TradingView snapshot link; upload other screenshots as files')
}
