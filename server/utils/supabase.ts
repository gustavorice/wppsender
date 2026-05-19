import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~~/types/supabase'
import { apiError } from './errors'

let cachedClient: SupabaseClient<Database> | null = null

export function getServerSupabase(): SupabaseClient<Database> {
  if (cachedClient) {
    return cachedClient
  }

  const config = useRuntimeConfig()
  const url = config.public.supabaseUrl
  const serviceRoleKey = config.supabaseServiceRoleKey

  if (!url || !serviceRoleKey) {
    throw apiError(500, 'Supabase nao configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.')
  }

  cachedClient = createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  })

  return cachedClient
}
