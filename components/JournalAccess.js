import { useEffect, useState } from 'react'

export default function JournalAccess({ children }) {
  const [status, setStatus] = useState('loading')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  useEffect(() => {
    const originalFetch = window.fetch.bind(window)
    // Every same-origin mutation carries a header that cross-origin forms cannot add.
    const guardedFetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, window.location.href)
      const method = (init.method || input?.method || 'GET').toUpperCase()
      if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
        const headers = new Headers(init.headers || input?.headers)
        if (!['GET', 'HEAD'].includes(method)) headers.set('X-Journal-Request', '1')
        const response = await originalFetch(input, { ...init, headers })
        if (response.status === 401) setStatus('signedOut')
        return response
      }
      return originalFetch(input, init)
    }
    window.fetch = guardedFetch
    let alive = true
    guardedFetch('/api/auth/session').then(r => { if (alive) setStatus(r.ok ? 'signedIn' : 'signedOut') }).catch(() => { if (alive) { setStatus('signedOut'); setMessage('Could not connect. Please try again.') } })
    if (new URLSearchParams(window.location.search).has('signInError')) setMessage('The link expired or was opened in another browser. Request a new link and open it in this browser.')
    return () => { alive = false; if (window.fetch === guardedFetch) window.fetch = originalFetch }
  }, [])
  const signIn = async e => {
    e.preventDefault(); setSending(true); setMessage('')
    try {
      const res = await fetch('/api/auth/sign-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
      const data = await res.json()
      setMessage(res.ok ? 'Check your email. Open the sign-in link in this browser to continue.' : data.error || 'Could not send the email.')
    } catch { setMessage('Could not connect. Please try again.') }
    setSending(false)
  }
  const signOut = async () => {
    const res = await fetch('/api/auth/sign-out', { method: 'POST' })
    if (res.ok) { setStatus('signedOut'); setMessage('Signed out.') }
    else alert('Could not sign out. Please try again.')
  }
  if (status === 'signedIn') return <><button onClick={signOut} style={{ position: 'fixed', right: 20, bottom: 12, zIndex: 1000, background: 'var(--sf, #172031)', color: 'var(--tx, #fff)', border: '1px solid var(--bd, #334155)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>Sign out</button>{children}</>
  return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0c1220', color: '#e8edf5', padding: 24 }}>
    <section style={{ width: '100%', maxWidth: 420, background: '#151f30', border: '1px solid #2b3b53', borderRadius: 16, padding: 32 }}>
      <div style={{ color: '#8fa3be', fontSize: 12, letterSpacing: 2 }}>TRADEINTEL</div>
      <h1 style={{ fontSize: 25, margin: '16px 0 10px' }}>Your private trading journal</h1>
      {status === 'loading' ? <p>Checking sign-in…</p> : <form onSubmit={signIn}>
        <p style={{ color: '#b2c0d3', lineHeight: 1.6 }}>Sign in with your approved email address. We’ll send you a secure link.</p>
        <label htmlFor="journal-email" style={{ display: 'block', margin: '22px 0 8px' }}>Email address</label>
        <input id="journal-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: 12, background: '#0c1220', color: '#fff', border: '1px solid #526680', borderRadius: 6 }} />
        <button disabled={sending} style={{ width: '100%', marginTop: 14, padding: 12, border: 0, borderRadius: 6, background: '#82dfbe', color: '#10231c', fontWeight: 700, cursor: 'pointer' }}>{sending ? 'Sending…' : 'Email me a sign-in link'}</button>
        {message && <p role="status" style={{ lineHeight: 1.6, color: '#c4d5ed', marginBottom: 0 }}>{message}</p>}
      </form>}
    </section>
  </main>
}
