import { createServerClient } from '@supabase/ssr'
import { serialize } from 'cookie'
import { ownerAllowed, trustedMutation } from './accessPolicy'

export function appUrl() {
  return process.env.JOURNAL_APP_URL || (process.env.NODE_ENV !== 'production' ? 'http://localhost:3000' : '')
}

export function authClient(req, res) {
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' },
    cookies: {
      getAll: () => Object.entries(req.cookies || {}).map(([name, value]) => ({ name, value })),
      setAll: cookies => {
        const previous = res.getHeader('Set-Cookie') || []
        res.setHeader('Set-Cookie', [...(Array.isArray(previous) ? previous : [previous]), ...cookies.map(({ name, value, options }) => serialize(name, value, { ...options, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' }))])
      },
    },
  })
}

export function privateResponse(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  res.setHeader('Vary', 'Cookie')
}

export function requireMutation(req, res) {
  if (trustedMutation(req, appUrl())) return true
  res.status(403).json({ error: 'Request blocked. Refresh the journal and try again.' })
  return false
}

export async function requireOwner(req, res) {
  privateResponse(res)
  if (!process.env.JOURNAL_OWNER_EMAIL || !appUrl()) {
    res.status(503).json({ error: 'Journal sign-in is not configured.' }); return false
  }
  if (!['GET', 'HEAD'].includes(req.method) && !requireMutation(req, res)) return false
  try {
    const { data: { user }, error } = await authClient(req, res).auth.getUser()
    if (error || !ownerAllowed(user, process.env.JOURNAL_OWNER_EMAIL)) {
      res.status(401).json({ error: 'Please sign in to your journal.' }); return false
    }
    return user
  } catch {
    res.status(503).json({ error: 'Sign-in is temporarily unavailable. Please try again.' }); return false
  }
}
