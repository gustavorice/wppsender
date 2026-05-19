<script setup lang="ts">
import { UserButton } from '@clerk/vue'

const route = useRoute()

const titles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/messages': 'Mensagens',
  '/contacts': 'Contatos',
  '/settings': 'Configuracoes',
  '/settings/whatsapp': 'WhatsApp',
  '/settings/team': 'Time'
}

const title = computed(() => titles[route.path] || 'RelayDesk')
</script>

<template>
  <header class="sticky top-0 z-20 border-b border-[#111111]/10 bg-[#f6f3ef]/90 px-4 py-3 backdrop-blur sm:px-6 lg:px-8">
    <div class="mx-auto flex w-full max-w-[1500px] items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-3">
        <NuxtLink to="/dashboard" class="flex h-9 w-9 items-center justify-center rounded-full bg-[#111111] text-[#fbfaf7] lg:hidden">
          <UIcon name="i-lucide-messages-square" class="h-5 w-5" />
        </NuxtLink>
        <div class="min-w-0">
          <h1 class="truncate text-base font-semibold text-[#111111]">{{ title }}</h1>
          <p class="truncate text-xs text-[#6b6258]">Atendimento multi-time em tempo real</p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <OrganizationSwitcher />
        <ClientOnly>
          <UserButton after-sign-out-url="/login" />
        </ClientOnly>
      </div>
    </div>
  </header>
</template>
