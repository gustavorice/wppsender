<script setup lang="ts">
import type { Contact, Conversation, WhatsAppAccount } from '~~/types/entities'
import { contactDisplayName, contactPhoneLabel, formatPhone, avatarColor, contactInitial } from '~/utils/phone'

type ContactStub = Contact & {
  whatsapp_account?: Pick<WhatsAppAccount, 'id' | 'display_name' | 'phone_number' | 'status'> | null
}

const props = defineProps<{
  conversations: Conversation[]
  orphanContacts?: ContactStub[]
  accounts: WhatsAppAccount[]
  activeConversationId?: string | null
  loading?: boolean
}>()

const emit = defineEmits<{
  select: [conversationId: string]
  selectContact: [contactId: string]
  filter: [payload: { search: string; whatsappAccountId: string | null }]
}>()

const orphanList = computed(() => props.orphanContacts ?? [])

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
  <section class="flex h-full min-h-0 flex-col border-r border-slate-200 bg-white">
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

    <div v-if="loading" class="min-h-0 flex-1 overflow-hidden" aria-busy="true" aria-label="Carregando conversas">
      <div
        v-for="n in 6"
        :key="`skeleton-conv-${n}`"
        class="flex w-full items-start gap-3 border-b border-slate-100 px-3 py-3"
      >
        <div class="h-10 w-10 shrink-0 animate-pulse rounded-md bg-slate-200" />
        <div class="min-w-0 flex-1 space-y-2">
          <div class="flex items-center justify-between gap-2">
            <div class="h-3.5 w-2/5 animate-pulse rounded-md bg-slate-200" />
            <div class="h-2.5 w-8 shrink-0 animate-pulse rounded-md bg-slate-200" />
          </div>
          <div class="h-3 w-4/5 animate-pulse rounded-md bg-slate-200" />
          <div class="h-2.5 w-1/3 animate-pulse rounded-md bg-slate-200" />
        </div>
      </div>
    </div>
    <EmptyState
      v-else-if="conversations.length === 0 && (!search || orphanList.length === 0)"
      class="m-3"
      icon="i-lucide-message-circle"
      title="Sem conversas"
      description="As mensagens recebidas aparecem aqui. Inicie uma conversa clicando num contato na aba Contatos."
    />

    <div v-else class="min-h-0 flex-1 overflow-y-auto">
      <button
        v-for="conversation in conversations"
        :key="conversation.id"
        class="flex w-full items-start gap-3 border-b border-slate-100 px-3 py-3 text-left transition hover:bg-slate-50"
        :class="conversation.id === activeConversationId ? 'bg-emerald-50' : 'bg-white'"
        @click="emit('select', conversation.id)"
      >
        <div class="h-10 w-10 shrink-0 overflow-hidden rounded-full">
          <img
            v-if="conversation.contact?.avatar_url"
            :src="conversation.contact.avatar_url"
            :alt="conversation.contact?.name || conversation.contact?.phone || ''"
            class="h-full w-full object-cover"
            loading="lazy"
            @error="(e: Event) => { const target = e.target as HTMLImageElement; target.style.display = 'none' }"
          />
          <div
            v-else
            class="flex h-full w-full items-center justify-center text-sm font-semibold"
            :class="avatarColor(conversation.contact?.wa_id)"
          >
            {{ contactInitial(conversation.contact) }}
          </div>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-2">
            <p class="truncate text-sm font-semibold text-slate-950">
              {{ contactDisplayName(conversation.contact) }}
            </p>
            <span class="shrink-0 text-[11px] text-slate-500">
              {{ conversation.last_message_at ? new Date(conversation.last_message_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '' }}
            </span>
          </div>
          <p class="mt-1 truncate text-xs text-slate-600">
            {{ conversation.last_message?.body || 'Nova conversa' }}
          </p>
        </div>
      </button>

      <div
        v-if="search && orphanList.length > 0"
        class="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
      >
        Contatos sem conversa ({{ orphanList.length }})
      </div>
      <button
        v-for="contact in (search ? orphanList : [])"
        :key="`contact-${contact.id}`"
        class="flex w-full items-start gap-3 border-b border-slate-100 px-3 py-3 text-left transition hover:bg-slate-50"
        @click="emit('selectContact', contact.id)"
      >
        <div class="h-10 w-10 shrink-0 overflow-hidden rounded-full">
          <img
            v-if="contact.avatar_url"
            :src="contact.avatar_url"
            :alt="contact.name || contact.phone || ''"
            class="h-full w-full object-cover"
            loading="lazy"
            @error="(e: Event) => { const target = e.target as HTMLImageElement; target.style.display = 'none' }"
          />
          <div
            v-else
            class="flex h-full w-full items-center justify-center text-sm font-semibold"
            :class="avatarColor(contact.wa_id)"
          >
            {{ contactInitial(contact) }}
          </div>
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-slate-900">
            {{ contactDisplayName(contact) }}
          </p>
          <p v-if="contactPhoneLabel(contact)" class="mt-1 truncate text-xs text-slate-500">
            {{ contactPhoneLabel(contact) }}
          </p>
        </div>
      </button>
    </div>
  </section>
</template>
