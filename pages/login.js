import { useState } from 'react'
import { useRouter } from 'next/router'
import { signIn } from '../lib/auth'
import Link from 'next/link'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await signIn(email, password)
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/')
    }
  }

  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#0c1117',padding:20}}>
      <div style={{background:'#161b22',border:'1px solid #30363d',borderRadius:12,padding:32,width:'100%',maxWidth:400}}>
        <div style={{textAlign:'center',marginBottom:24}}>
          <div style={{fontSize:20,fontWeight:700,letterSpacing:0.05}}>Trading Journal</div>
          <div style={{fontSize:12,color:'#8b949e',marginTop:4}}>Sign in to continue</div>
        </div>
        {error && <div style={{background:'rgba(185,65,68,0.1)',border:'1px solid rgba(185,65,68,0.2)',color:'#b94144',padding:8,borderRadius:6,fontSize:12,marginBottom:12}}>{error}</div>}
        <form onSubmit={handleSubmit} style={{display:'flex',flexDirection:'column',gap:12}}>
          <input type="email" placeholder="Email" required value={email} onChange={e=>setEmail(e.target.value)} style={{background:'#0c1117',border:'1px solid #30363d',color:'#e6edf3',padding:10,borderRadius:6,fontSize:13}} />
          <input type="password" placeholder="Password" required value={password} onChange={e=>setPassword(e.target.value)} style={{background:'#0c1117',border:'1px solid #30363d',color:'#e6edf3',padding:10,borderRadius:6,fontSize:13}} />
          <button type="submit" disabled={loading} style={{background:'#4bde80',color:'#0c1117',border:'none',padding:10,borderRadius:6,fontWeight:600,cursor:loading?'wait':'pointer',fontSize:13}}>{loading ? 'Signing in...' : 'Sign In'}</button>
        </form>
        <div style={{textAlign:'center',marginTop:16,fontSize:12,color:'#8b949e'}}>
          New here? <Link href="/signup" style={{color:'#4bde80',textDecoration:'none'}}>Create account</Link>
        </div>
      </div>
    </div>
  )
}