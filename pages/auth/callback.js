import { authClient, privateResponse } from '../../lib/serverAuth'
import { ownerAllowed } from '../../lib/accessPolicy'
export default function Callback() { return null }
export async function getServerSideProps({ req, res, query }) {
  privateResponse(res)
  if (typeof query.code === 'string' && query.code.length < 2048) {
    const client = authClient(req, res)
    const { data, error } = await client.auth.exchangeCodeForSession(query.code)
    if (!error && ownerAllowed(data.user, process.env.JOURNAL_OWNER_EMAIL)) return { redirect: { destination: '/', permanent: false } }
    await client.auth.signOut({ scope: 'local' })
  }
  return { redirect: { destination: '/?signInError=1', permanent: false } }
}
