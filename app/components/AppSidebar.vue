<script setup lang="ts">
const route = useRoute()

const links = [
  { label: 'Dashboard', to: '/dashboard', icon: 'i-lucide-layout-dashboard' },
  { label: 'Mensagens', to: '/messages', icon: 'i-lucide-message-circle' },
  { label: 'Contatos', to: '/contacts', icon: 'i-lucide-users' },
  { label: 'WhatsApp', to: '/settings/whatsapp', icon: 'i-lucide-smartphone' },
  { label: 'Time', to: '/settings/team', icon: 'i-lucide-building-2' }
]

function isActive(to: string) {
  return route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <aside class="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-[#111111]/10 bg-[#111111] px-3 py-4 text-[#fbfaf7] lg:block">
    <NuxtLink to="/dashboard" class="mb-6 flex items-center gap-3 rounded-lg px-3 py-2">
      <div class="flex h-9 w-9 items-center justify-center rounded-full bg-[#fbfaf7] text-[#111111]">
        <UIcon name="i-lucide-messages-square" class="h-5 w-5" />
      </div>
      <div class="min-w-0">
        <p class="truncate text-sm font-semibold text-[#fbfaf7]">WppSender</p>
        <p class="truncate text-xs text-[#b9b2aa]">WhatsApp Teams</p>
      </div>
    </NuxtLink>

    <nav class="space-y-1">
      <NuxtLink
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        class="flex items-center gap-3 rounded-full px-3 py-2 text-sm font-medium transition"
        :class="isActive(link.to) ? 'bg-[#fbfaf7] text-[#111111]' : 'text-[#b9b2aa] hover:bg-white/10 hover:text-[#fbfaf7]'"
      >
        <UIcon :name="link.icon" class="h-4 w-4" />
        <span>{{ link.label }}</span>
      </NuxtLink>
    </nav>

    <div class="absolute bottom-4 left-3 right-3 rounded-lg border border-white/10 bg-white/[0.06] p-3">
      <p class="text-xs font-medium text-[#fbfaf7]">Evolution API</p>
      <p class="mt-1 text-xs leading-5 text-[#b9b2aa]">Instancias e webhooks rodam apenas pelo server.</p>
    </div>
  </aside>
</template>
