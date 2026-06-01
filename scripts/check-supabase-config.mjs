import { existsSync, readFileSync } from 'node:fs'
import dns from 'node:dns/promises'

const env = {
  ...process.env,
  ...readEnvFile('.env'),
  ...readEnvFile('.env.local'),
}

const supabaseUrl = String(env.VITE_SUPABASE_URL || '').trim()
const anonKey = String(env.VITE_SUPABASE_ANON_KEY || '').trim()

let hasError = false

if (!supabaseUrl) {
  console.error('Missing VITE_SUPABASE_URL.')
  hasError = true
}

if (!anonKey) {
  console.error('Missing VITE_SUPABASE_ANON_KEY.')
  hasError = true
}

if (hasError) process.exit(1)

let url
try {
  url = new URL(supabaseUrl)
} catch {
  console.error('VITE_SUPABASE_URL is not a valid URL.')
  process.exit(1)
}

console.log(`Supabase URL: ${url.origin}`)
console.log(`Anon key configured: ${anonKey.length > 20 ? 'yes' : 'too short'}`)

try {
  const records = await dns.resolve(url.hostname)
  console.log(`DNS: ok (${records.length} record${records.length === 1 ? '' : 's'})`)
} catch (error) {
  console.error(`DNS: failed for ${url.hostname} (${error.code || error.message})`)
  process.exit(1)
}

try {
  const response = await fetch(new URL('/auth/v1/health', url), { cache: 'no-store' })
  console.log(`Auth health: HTTP ${response.status}`)
  if (response.status >= 500) process.exitCode = 1
} catch (error) {
  console.error(`Auth health: failed (${error.message})`)
  process.exit(1)
}

function readEnvFile(path) {
  if (!existsSync(path)) return {}

  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .reduce((values, line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return values
      const separator = trimmed.indexOf('=')
      if (separator === -1) return values
      const key = trimmed.slice(0, separator).trim()
      const value = trimmed
        .slice(separator + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '')
      values[key] = value
      return values
    }, {})
}
