import '../styles/globals.css'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { getSession } from '../lib/auth'

export default function App({ Component, pageProps }) {
  const [authReady, setAuthReady] = useState(false)
  const router = useRouter()
  const isPublic = router.pathname === '/login' || router.pathname === '/signup'

  useEffect(() => {
    const checkAuth = async () => {
      const session = await getSession()
      if (!session && !isPublic) {
        router.replace('/login')
      } else {
        setAuthReady(true)
      }
    }
    checkAuth()
  }, [isPublic, router])

  if (!authReady) return <div style={{background:'#0c1117',height:'100vh'}} />
  return <Component {...pageProps} />
}