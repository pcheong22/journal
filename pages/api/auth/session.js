import { requireOwner } from '../../../lib/serverAuth'
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = await requireOwner(req, res)
  if (user) res.status(200).json({ signedIn: true })
}
