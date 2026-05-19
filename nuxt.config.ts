export default defineNuxtConfig({
  compatibilityDate: '2026-05-19',
  devtools: { enabled: true },
  modules: ['@nuxt/ui', '@pinia/nuxt', '@clerk/nuxt'],
  css: ['~/assets/css/main.css'],
  typescript: {
    strict: true,
    typeCheck: true
  },
  app: {
    head: {
      title: 'RelayDesk WhatsApp',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content: 'MVP SaaS para atendimento WhatsApp multi-time com Clerk, Supabase Realtime e Evolution API.'
        }
      ]
    }
  },
  runtimeConfig: {
    clerkSecretKey: process.env.CLERK_SECRET_KEY || process.env.NUXT_CLERK_SECRET_KEY,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    evolutionApiUrl: process.env.EVOLUTION_API_URL,
    evolutionApiKey: process.env.EVOLUTION_API_KEY,
    evolutionWebhookUrl: process.env.EVOLUTION_WEBHOOK_URL,
    resendApiKey: process.env.RESEND_API_KEY,
    upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL,
    upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN,
    public: {
      clerkPublishableKey: process.env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
      sentryDsn: process.env.SENTRY_DSN
    }
  },
  clerk: {
    signInUrl: '/login',
    signUpUrl: '/login',
    signInForceRedirectUrl: '/dashboard',
    signUpForceRedirectUrl: '/dashboard'
  },
  colorMode: {
    preference: 'light'
  }
})
