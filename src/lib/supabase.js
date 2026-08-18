import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = normalizeEnv(import.meta.env.VITE_SUPABASE_URL)
export const supabaseAnonKey = normalizeEnv(import.meta.env.VITE_SUPABASE_ANON_KEY)

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey)
export const supabaseConfigIssue = getSupabaseConfigIssue()

export function createSupabaseClient() {
  if (!hasSupabaseConfig || supabaseConfigIssue) return null

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

function getSupabaseConfigIssue() {
  if (!supabaseUrl || !supabaseAnonKey) {
    return 'Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY para cargar datos remotos desde Supabase.'
  }

  try {
    const url = new URL(supabaseUrl)
    const isLocal = ['localhost', '127.0.0.1'].includes(url.hostname)
    if (url.protocol !== 'https:' && !isLocal) {
      return 'VITE_SUPABASE_URL debe usar HTTPS para conectarse a Supabase en producción.'
    }
  } catch {
    return 'VITE_SUPABASE_URL no es una URL válida. Debe tener formato https://proyecto.supabase.co.'
  }

  return ''
}

function normalizeEnv(value) {
  return typeof value === 'string' ? value.trim() : ''
}
