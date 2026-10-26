import { authClient, privateResponse, requireMutation } from '../../../lib/serverAuth'
export default async function handler(req, res) {
  privateResponse(res)
  if (req.method !== 'POST') return res.status(405).end()
  if (!requireMutation(req, res)) return
  const { error } = await authClient(req, res).auth.signOut({ scope: 'local' })
  if (error) return res.status(503).json({ error: 'Could not sign out. Please try again.' })
  res.status(200).json({ signedOut: true })
}
