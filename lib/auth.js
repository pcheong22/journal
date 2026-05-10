import { supabase } from './supabase'

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  return { data, error }
}

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  return { data, error }
}

export async function signOut() {
  await supabase.auth.signOut()
  window.location.href = '/login'
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}