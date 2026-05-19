<script setup lang="ts">
import { SignIn, SignUp } from '@clerk/vue'

const route = useRoute()
const config = useRuntimeConfig()
const mode = computed(() => (route.query.mode === 'sign-up' ? 'sign-up' : 'sign-in'))
const hasClerkKey = computed(() => Boolean(config.public.clerkPublishableKey))

const clerkAppearance = {
  variables: {
    colorPrimary: '#111111',
    colorText: '#111111',
    colorTextSecondary: '#665f55',
    colorBackground: 'transparent',
    colorInputBackground: '#ffffff',
    colorInputText: '#111111',
    borderRadius: '16px',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
  },
  elements: {
    rootBox: 'w-full',
    card: 'w-full shadow-none border-0 bg-transparent p-0',
    header: 'text-left',
    headerTitle: 'text-left',
    headerSubtitle: 'text-left',
    socialButtonsBlockButton: 'rounded-full',
    formButtonPrimary: 'rounded-full',
    footer: 'bg-transparent'
  }
}
</script>

<template>
  <main class="product-surface min-h-screen px-4 py-5 text-[#111111] sm:px-6 lg:px-8">
    <div class="mx-auto flex min-h-[calc(100vh-40px)] w-full max-w-7xl items-center">
      <div class="grid w-full gap-5 lg:grid-cols-[minmax(0,1fr)_460px] lg:items-stretch">
        <section class="hairline-panel relative order-2 hidden overflow-hidden rounded-lg bg-[#fbfaf7] p-6 sm:p-8 lg:order-1 lg:block lg:min-h-[680px] lg:p-10">
          <div class="absolute right-8 top-8 hidden h-32 w-32 rounded-full bg-[#d8e6ff] blur-3xl lg:block" />
          <div class="relative flex h-full flex-col justify-between gap-12">
            <div>
              <div class="flex items-center gap-3">
                <div class="flex h-10 w-10 items-center justify-center rounded-full bg-[#111111] text-[#fbfaf7]">
                  <UIcon name="i-lucide-messages-square" class="h-5 w-5" />
                </div>
                <div>
                  <p class="text-sm font-semibold text-[#111111]">WppSender</p>
                  <p class="text-xs text-[#6b6258]">WhatsApp inbox for teams</p>
                </div>
              </div>

              <div class="mt-16 max-w-3xl">
                <p class="mb-5 inline-flex rounded-full border border-[#111111]/10 bg-white px-3 py-1 text-xs font-medium text-[#5f5a53]">
                  Multi-tenant CRM inbox
                </p>
                <h1 class="max-w-3xl text-4xl font-semibold leading-[1.04] tracking-[-0.01em] text-[#111111] sm:text-5xl lg:text-6xl">
                  Atendimento WhatsApp organizado por time, numero e conversa.
                </h1>
                <p class="mt-6 max-w-2xl text-base leading-7 text-[#5f5a53] sm:text-lg">
                  Conecte numeros via QR Code, receba mensagens em tempo real e mantenha contatos isolados por organizacao.
                </p>
              </div>
            </div>

            <div class="grid gap-3 md:grid-cols-3">
              <div class="rounded-lg border border-[#111111]/10 bg-white/80 p-4">
                <p class="text-2xl font-semibold text-[#111111]">Realtime</p>
                <p class="mt-2 text-sm leading-6 text-[#6b6258]">Threads atualizadas por Supabase Realtime.</p>
              </div>
              <div class="rounded-lg border border-[#111111]/10 bg-white/80 p-4">
                <p class="text-2xl font-semibold text-[#111111]">Org-first</p>
                <p class="mt-2 text-sm leading-6 text-[#6b6258]">Dados filtrados por Clerk Organization.</p>
              </div>
              <div class="rounded-lg border border-[#111111]/10 bg-white/80 p-4">
                <p class="text-2xl font-semibold text-[#111111]">QR flow</p>
                <p class="mt-2 text-sm leading-6 text-[#6b6258]">Instancias Evolution sem usar telefone como nome.</p>
              </div>
            </div>
          </div>
        </section>

        <aside class="hairline-panel order-1 flex min-h-[calc(100vh-40px)] rounded-lg bg-[#fbfaf7] p-5 sm:p-8 lg:order-2 lg:min-h-[680px]">
          <div class="clerk-auth-panel flex w-full flex-col justify-center">
            <div class="mx-auto mb-8 flex w-full max-w-[430px] items-center justify-between gap-4">
              <div class="flex items-center gap-3">
                <div class="flex h-10 w-10 items-center justify-center rounded-full bg-[#111111] text-[#fbfaf7]">
                  <UIcon name="i-lucide-messages-square" class="h-5 w-5" />
                </div>
                <div>
                  <p class="text-sm font-semibold text-[#111111]">WppSender</p>
                  <p class="text-xs text-[#6b6258]">WhatsApp inbox</p>
                </div>
              </div>
            </div>
            <ClientOnly v-if="hasClerkKey">
              <SignIn
                v-if="mode === 'sign-in'"
                routing="path"
                path="/login"
                sign-up-url="/login?mode=sign-up"
                :appearance="clerkAppearance"
              />
              <SignUp
                v-else
                routing="path"
                path="/login"
                sign-in-url="/login"
                :appearance="clerkAppearance"
              />
            </ClientOnly>
            <div v-else class="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
              Configure `NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY` e `CLERK_SECRET_KEY` no `.env` para habilitar login, cadastro e Organizations.
            </div>
          </div>
        </aside>
      </div>
    </div>
  </main>
</template>
