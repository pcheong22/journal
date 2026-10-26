import { authClient, appUrl, privateResponse, requireMutation } from '../../../lib/serverAuth'
export default async function handler(req, res) {
  privateResponse(res)
  if (req.method !== 'POST') return res.status(405).end()
  if (!requireMutation(req, res)) return
  const owner = process.env.JOURNAL_OWNER_EMAIL?.trim().toLowerCase()
  if (!owner || !appUrl()) return res.status(503).json({ error: 'Journal sign-in is not configured.' })
  if (typeof req.body?.email !== 'string' || req.body.email.trim().toLowerCase() !== owner) return res.status(403).json({ error: 'This email is not permitted to access the journal.' })
  try {
    // Only the pre-provisioned owner can sign in. Supabase enforces email rate limits.
    const { error } = await authClient(req, res).auth.signInWithOtp({ email: owner,
      options: { shouldCreateUser: false, emailRedirectTo: `${appUrl()}/auth/callback` } })
    if (error) return res.status(error.status === 429 ? 429 : 503).json({ error: 'Unable to send a sign-in email. Please wait a minute and try again.' })
    return res.status(200).json({ sent: true })
  } catch { return res.status(503).json({ error: 'Sign-in is temporarily unavailable.' }) }
}
