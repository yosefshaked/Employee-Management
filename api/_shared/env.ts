const APP_SUPABASE_URL_ENV = 'APP_SUPABASE_URL'
const APP_SUPABASE_ANON_KEY_ENV = 'APP_SUPABASE_ANON_KEY'
const APP_SUPABASE_SERVICE_ROLE_ENV = 'APP_SUPABASE_SERVICE_ROLE'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing environment variable ${name}`)
  }
  return value
}

export function getControlSupabaseConfig() {
  const url = requireEnv(APP_SUPABASE_URL_ENV)
  const anonKey = requireEnv(APP_SUPABASE_ANON_KEY_ENV)

  return { url, anonKey }
}

export function getControlSupabaseServiceRole() {
  const url = requireEnv(APP_SUPABASE_URL_ENV)
  const serviceRoleKey = requireEnv(APP_SUPABASE_SERVICE_ROLE_ENV)

  return { url, serviceRoleKey }
}
