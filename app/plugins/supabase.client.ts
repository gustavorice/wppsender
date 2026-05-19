import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~~/types/supabase'

declare module '#app' {
  interface NuxtApp {
    $supabase: SupabaseClient<Database>
  }
}

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const { getToken, isSignedIn } = useAuth()

  const supabase = createClient<Database>(
    config.public.supabaseUrl || 'https://example.supabase.co',
    config.public.supabaseAnonKey || 'missing-anon-key',
    {
      accessToken: async () => {
        if (!isSignedIn.value || !getToken.value) {
          return null
        }

        return getToken.value({ template: 'supabase' })
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    }
  )

  return {
    provide: {
      supabase
    }
  }
})
