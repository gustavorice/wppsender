<script setup lang="ts">
import type { Conversation, WhatsAppAccount } from '~~/types/entities'

const props = defineProps<{
  conversations: Conversation[]
  accounts: WhatsAppAccount[]
  activeConversationId?: string | null
  loading?: boolean
}>()

const emit = defineEmits<{
  select: [conversationId: string]
  filter: [payload: { search: string; whatsappAccountId: string | null }]
}>()

const search = ref('')
const whatsappAccountId = ref<string | null>(null)

const accountOptions = computed(() => [
  { label: 'Todos os numeros', value: null },
  ...props.accounts.map((account) => ({
    label: account.display_name || account.phone_number || 'WhatsApp',
    value: account.id
  }))
])

watch([search, whatsappAccountId], () => {
  emit('filter', {
    search: search.value,
    whatsappAccountId: whatsappAccountId.value
  })
})
</script>

<template>
  <section class="flex min-h-[calc(100vh-120px)] flex-col border-r border-slate-200 bg-white">
    <div class="border-b border-slate-200 p-3">
      <div class="flex items-center gap-2">
        <UInput v-model="search" icon="i-lucide-search" placeholder="Buscar contato" class="w-full" />
      </div>
      <select
        v-model="whatsappAccountId"
        class="mt-2 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      >
        <option v-for="option in accountOptions" :key="String(option.value)" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </div>

    <LoadingState v-if="loading" label="Carregando conversas" />
    <EmptyState
      v-else-if="conversations.length === 0"
      class="m-3"
      icon="i-lucide-message-circle"
      title="Sem conversas"
      description="As mensagens recebidas pela Evolution API aparecem aqui em tempo real."
    />

    <div v-else class="min-h-0 flex-1 overflow-y-auto">
      <button
        v-for="conversation in conversations"
        :key="conversation.id"
        class="flex w-full items-start gap-3 border-b border-slate-100 px-3 py-3 text-left transition hover:bg-slate-50"
        :class="conversation.id === activeConversationId ? 'bg-emerald-50' : 'bg-white'"
        @click="emit('select', conversation.id)"
      >
        <div class="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-slate-100">
          <img
            v-if="conversation.contact?.avatar_url"
            :src="conversation.contact.avatar_url"
            :alt="conversation.contact?.name || conversation.contact?.phone || ''"
            class="h-full w-full object-cover"
            loading="lazy"
            @error="(e: Event) => { const target = e.target as HTMLImageElement; target.style.display = 'none' }"
          />
          <div v-else class="flex h-full w-full items-center justify-center text-sm font-semibold text-slate-700">
            {{ (conversation.contact?.name || conversation.contact?.phone || '?').slice(0, 1).toUpperCase() }}
          </div>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-2">
            <p class="truncate text-sm font-semibold text-slate-950">
              {{ conversation.contact?.name || conversation.contact?.phone || 'Contato' }}
            </p>
            <span class="shrink-0 text-[11px] text-slate-500">
              {{ conversation.last_message_at ? new Date(conversation.last_message_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '' }}
            </span>
          </div>
          <p class="mt-1 truncate text-xs text-slate-600">
            {{ conversation.last_message?.body || conversation.contact?.phone || 'Nova conversa' }}
          </p>
          <p class="mt-1 truncate text-[11px] text-slate-500">
            {{ conversation.whatsapp_account?.display_name || conversation.whatsapp_account?.phone_number || 'WhatsApp' }}
          </p>
        </div>
      </button>
    </div>
  </section>
</template>
