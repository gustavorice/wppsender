<script setup lang="ts">
definePageMeta({ layout: 'private' })

const { fetchAccounts, accounts, connectedAccounts } = useWhatsappAccounts()
const { fetchConversations, conversations, loading } = useConversations()
const { fetchContacts, contacts } = useContacts()

useRealtimeConversations()

const todayMessages = computed(() => {
  const today = new Date().toISOString().slice(0, 10)
  return conversations.value.filter((conversation) => conversation.last_message_at?.startsWith(today)).length
})

const openConversations = computed(() => conversations.value.filter((conversation) => conversation.status === 'open').length)
const pendingAccounts = computed(() => accounts.value.filter((account) => account.status === 'pending').length)
const disconnectedAccounts = computed(() => accounts.value.filter((account) => ['disconnected', 'error'].includes(account.status)).length)
const recentConversations = computed(() => conversations.value.slice(0, 6))

const channelHealth = computed(() => {
  if (connectedAccounts.value.length > 0) {
    return 'Operacao ativa'
  }

  if (pendingAccounts.value > 0) {
    return 'Aguardando QR Code'
  }

  return 'Conecte o primeiro numero'
})

onMounted(async () => {
  await Promise.all([fetchAccounts(), fetchConversations(), fetchContacts()])
})
</script>

<template>
  <div class="space-y-6">
    <section class="hairline-panel overflow-hidden rounded-lg bg-[#fbfaf7]">
      <div class="grid gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div class="p-5 sm:p-6 lg:p-8">
          <div class="flex flex-col justify-between gap-5 md:flex-row md:items-start">
            <div class="max-w-2xl">
              <p class="inline-flex rounded-full border border-[#111111]/10 bg-white px-3 py-1 text-xs font-medium text-[#5f5a53]">
                {{ channelHealth }}
              </p>
              <h1 class="mt-5 text-3xl font-semibold leading-tight tracking-[-0.01em] text-[#111111] sm:text-4xl">
                Inbox operacional para mensagens, contatos e numeros conectados.
              </h1>
              <p class="mt-3 text-sm leading-6 text-[#6b6258]">
                Acompanhe a fila do time, conecte canais via Evolution API e mantenha cada conversa isolada por organizacao.
              </p>
            </div>
            <div class="flex shrink-0 gap-2">
              <UButton to="/messages" icon="i-lucide-message-circle" color="neutral" class="rounded-full">
                Abrir inbox
              </UButton>
              <UButton to="/settings/whatsapp" icon="i-lucide-qr-code" variant="outline" color="neutral" class="rounded-full">
                Conectar
              </UButton>
            </div>
          </div>

          <div class="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div class="rounded-lg border border-[#111111]/10 bg-white p-4">
              <div class="flex items-center justify-between">
                <p class="text-xs font-medium uppercase text-[#7a7167]">Numeros</p>
                <UIcon name="i-lucide-smartphone" class="h-4 w-4 text-[#111111]" />
              </div>
              <p class="mt-4 text-3xl font-semibold text-[#111111]">{{ connectedAccounts.length }}</p>
              <p class="mt-1 text-xs text-[#6b6258]">{{ accounts.length }} cadastrados</p>
            </div>
            <div class="rounded-lg border border-[#111111]/10 bg-white p-4">
              <div class="flex items-center justify-between">
                <p class="text-xs font-medium uppercase text-[#7a7167]">Mensagens hoje</p>
                <UIcon name="i-lucide-radio" class="h-4 w-4 text-[#111111]" />
              </div>
              <p class="mt-4 text-3xl font-semibold text-[#111111]">{{ todayMessages }}</p>
              <p class="mt-1 text-xs text-[#6b6258]">conversas com atividade</p>
            </div>
            <div class="rounded-lg border border-[#111111]/10 bg-white p-4">
              <div class="flex items-center justify-between">
                <p class="text-xs font-medium uppercase text-[#7a7167]">Fila aberta</p>
                <UIcon name="i-lucide-inbox" class="h-4 w-4 text-[#111111]" />
              </div>
              <p class="mt-4 text-3xl font-semibold text-[#111111]">{{ openConversations }}</p>
              <p class="mt-1 text-xs text-[#6b6258]">conversas em aberto</p>
            </div>
            <div class="rounded-lg border border-[#111111]/10 bg-white p-4">
              <div class="flex items-center justify-between">
                <p class="text-xs font-medium uppercase text-[#7a7167]">Contatos</p>
                <UIcon name="i-lucide-users" class="h-4 w-4 text-[#111111]" />
              </div>
              <p class="mt-4 text-3xl font-semibold text-[#111111]">{{ contacts.length }}</p>
              <p class="mt-1 text-xs text-[#6b6258]">no CRM do time</p>
            </div>
          </div>
        </div>

        <aside class="border-t border-[#111111]/10 bg-[#111111] p-5 text-[#fbfaf7] lg:border-l lg:border-t-0 lg:p-6">
          <p class="text-sm font-semibold">Status dos canais</p>
          <div class="mt-5 space-y-4">
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm text-[#d8d1c8]">Conectados</span>
              <span class="rounded-full bg-[#fbfaf7] px-3 py-1 text-sm font-semibold text-[#111111]">{{ connectedAccounts.length }}</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm text-[#d8d1c8]">Pendentes</span>
              <span class="rounded-full border border-white/15 px-3 py-1 text-sm font-semibold">{{ pendingAccounts }}</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm text-[#d8d1c8]">Desconectados</span>
              <span class="rounded-full border border-white/15 px-3 py-1 text-sm font-semibold">{{ disconnectedAccounts }}</span>
            </div>
          </div>
          <div class="mt-8 rounded-lg border border-white/10 bg-white/[0.06] p-4">
            <p class="text-sm font-medium">Proximo passo</p>
            <p class="mt-2 text-sm leading-6 text-[#d8d1c8]">
              Configure a Evolution API publica para trocar o mock por QR Code real.
            </p>
          </div>
        </aside>
      </div>
    </section>

    <section class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div class="hairline-panel rounded-lg bg-[#fbfaf7]">
        <div class="flex items-center justify-between border-b border-[#111111]/10 p-5">
          <div>
            <h2 class="text-sm font-semibold text-[#111111]">Conversas recentes</h2>
            <p class="mt-1 text-xs text-[#6b6258]">Atualizadas pelo webhook e pelo Realtime.</p>
          </div>
          <UButton to="/messages" icon="i-lucide-arrow-right" variant="outline" color="neutral" class="rounded-full">
            Abrir
          </UButton>
        </div>

        <LoadingState v-if="loading" label="Carregando conversas" />
        <EmptyState
          v-else-if="conversations.length === 0"
          class="m-5"
          title="Nenhuma conversa ainda"
          description="Conecte um numero e receba uma mensagem para abrir a primeira conversa."
          action-label="Conectar WhatsApp"
          action-to="/settings/whatsapp"
        />
        <div v-else class="divide-y divide-[#111111]/10">
          <NuxtLink
            v-for="conversation in recentConversations"
            :key="conversation.id"
            to="/messages"
            class="grid gap-3 p-5 transition hover:bg-white sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
          >
            <div class="min-w-0">
              <p class="truncate text-sm font-semibold text-[#111111]">{{ conversation.contact?.name || conversation.contact?.phone || 'Contato' }}</p>
              <p class="mt-1 truncate text-sm text-[#6b6258]">{{ conversation.last_message?.body || conversation.contact?.phone || 'Nova conversa' }}</p>
            </div>
            <span class="text-xs text-[#7a7167]">
              {{ conversation.last_message_at ? new Date(conversation.last_message_at).toLocaleString('pt-BR') : '' }}
            </span>
          </NuxtLink>
        </div>
      </div>

      <div class="hairline-panel rounded-lg bg-[#dfe9ff] p-5">
        <p class="text-sm font-semibold text-[#111111]">Checklist do MVP</p>
        <div class="mt-5 space-y-3">
          <div class="flex items-start gap-3">
            <UIcon name="i-lucide-check-circle-2" class="mt-0.5 h-4 w-4 text-[#111111]" />
            <p class="text-sm leading-6 text-[#3f3a34]">Clerk Organizations ativo com roles do time.</p>
          </div>
          <div class="flex items-start gap-3">
            <UIcon name="i-lucide-check-circle-2" class="mt-0.5 h-4 w-4 text-[#111111]" />
            <p class="text-sm leading-6 text-[#3f3a34]">Supabase com RLS e tabelas do atendimento.</p>
          </div>
          <div class="flex items-start gap-3">
            <UIcon name="i-lucide-circle" class="mt-0.5 h-4 w-4 text-[#5f5a53]" />
            <p class="text-sm leading-6 text-[#3f3a34]">Evolution API publica para conectar numeros reais.</p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
