import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = normalizeEnv(import.meta.env.VITE_SUPABASE_URL)
export const supabaseAnonKey = normalizeEnv(import.meta.env.VITE_SUPABASE_ANON_KEY)

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey)
export const supabaseConfigIssue = getSupabaseConfigIssue()

export function createSupabaseClient() {
  if (!hasSupabaseConfig || supabaseConfigIssue) return null

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
}

export function getSupabaseHost() {
  try {
    return new URL(supabaseUrl).host
  } catch {
    return ''
  }
}

export async function checkSupabaseReachability(timeoutMs = 6500) {
  if (supabaseConfigIssue) {
    return { ok: false, message: supabaseConfigIssue }
  }

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(new URL('/auth/v1/health', supabaseUrl), {
      cache: 'no-store',
      signal: controller.signal,
    })

    if (response.status >= 500) {
      return {
        ok: false,
        message: `Supabase respondió con estado ${response.status}. Revisa el estado del proyecto antes de enviar el magic link.`,
      }
    }

    return { ok: true }
  } catch (error) {
    return { ok: false, message: formatSupabaseError(error) }
  } finally {
    window.clearTimeout(timeout)
  }
}

export function formatSupabaseError(error, fallback = 'No fue posible completar la operación en Supabase.') {
  const message = String(error?.message || error || '').trim()
  const lowerMessage = message.toLowerCase()
  const host = getSupabaseHost() || 'la URL configurada'

  if (error?.name === 'AbortError' || lowerMessage.includes('timeout')) {
    return `Supabase tardó demasiado en responder (${host}). Revisa que el proyecto esté activo y que la URL sea correcta.`
  }

  if (
    lowerMessage.includes('failed to fetch') ||
    lowerMessage.includes('fetch failed') ||
    lowerMessage.includes('network') ||
    lowerMessage.includes('enotfound') ||
    lowerMessage.includes('load failed')
  ) {
    return `No fue posible conectar con Supabase (${host}). Revisa que VITE_SUPABASE_URL apunte a un proyecto activo y que el dominio resuelva.`
  }

  if (lowerMessage.includes('email rate limit exceeded') || lowerMessage.includes('rate limit')) {
    return 'Supabase bloqueó temporalmente el envío de correos por límite de tasa. Espera unos minutos o configura SMTP propio para producción.'
  }

  if (lowerMessage.includes('redirect') || lowerMessage.includes('not allowed')) {
    return 'Supabase rechazó la URL de retorno. Agrega la URL local y la URL de GitHub Pages en Authentication > URL Configuration.'
  }

  return message || fallback
}

function getSupabaseConfigIssue() {
  if (!supabaseUrl || !supabaseAnonKey) {
    return 'Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY para habilitar el acceso privado.'
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
