<script setup lang="ts">
import type { Conversation } from '~~/types/entities'
import { formatPhone } from '~/utils/phone'

const props = defineProps<{
  conversation: Conversation | null
}>()

const waLink = computed(() => {
  const phone = props.conversation?.contact?.phone || props.conversation?.contact?.wa_id
  if (!phone) return null
  return `https://wa.me/${phone.replace(/\D/g, '')}`
})

const lastSeen = computed(() => {
  const iso = props.conversation?.last_message_at
  if (!iso) return null
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
})
</script>

<template>
  <aside class="hidden h-full min-h-0 overflow-y-auto border-l border-slate-200 bg-white xl:block">
    <div v-if="conversation" class="p-4">
      <div class="flex flex-col items-center text-center">
        <div class="h-20 w-20 overflow-hidden rounded-full bg-emerald-50">
          <img
            v-if="conversation.contact?.avatar_url"
            :src="conversation.contact.avatar_url"
            :alt="conversation.contact?.name || ''"
            class="h-full w-full object-cover"
            loading="lazy"
            @error="(e: Event) => { const target = e.target as HTMLImageElement; target.style.display = 'none' }"
          />
          <div v-else class="flex h-full w-full items-center justify-center text-2xl font-semibold text-emerald-800">
            {{ (conversation.contact?.name || conversation.contact?.phone || '?').slice(0, 1).toUpperCase() }}
          </div>
        </div>
        <h3 class="mt-3 truncate text-base font-semibold text-slate-950">
          {{ conversation.contact?.name || formatPhone(conversation.contact?.phone) || 'Sem nome' }}
        </h3>
        <p class="mt-0.5 text-xs text-slate-500">{{ formatPhone(conversation.contact?.phone) }}</p>
        <a
          v-if="waLink"
          :href="waLink"
          target="_blank"
          rel="noopener noreferrer"
          class="mt-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
        >
          <UIcon name="i-lucide-external-link" class="h-3.5 w-3.5" />
          Abrir no WhatsApp
        </a>
      </div>

      <div class="mt-6 space-y-4">
        <div>
          <p class="text-[11px] font-medium uppercase tracking-wide text-slate-500">Última atividade</p>
          <p class="mt-1 text-sm text-slate-900">{{ lastSeen || 'Sem atividade ainda' }}</p>
        </div>

        <div>
          <p class="text-[11px] font-medium uppercase tracking-wide text-slate-500">Número</p>
          <p class="mt-1 truncate text-sm text-slate-900">
            {{ conversation.whatsapp_account?.display_name || conversation.whatsapp_account?.phone_number || '—' }}
          </p>
        </div>

        <div>
          <p class="text-[11px] font-medium uppercase tracking-wide text-slate-500">Status</p>
          <UBadge class="mt-1" variant="soft" color="success">{{ conversation.status }}</UBadge>
        </div>

        <div>
          <p class="text-[11px] font-medium uppercase tracking-wide text-slate-500">Responsável</p>
          <p class="mt-1 text-sm text-slate-900">{{ conversation.assigned_to_user_id || 'Não atribuído' }}</p>
        </div>

        <div>
          <p class="text-[11px] font-medium uppercase tracking-wide text-slate-500">Tags</p>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <UBadge
              v-for="tag in conversation.contact?.tags || []"
              :key="tag"
              color="neutral"
              variant="soft"
            >{{ tag }}</UBadge>
            <span v-if="!conversation.contact?.tags?.length" class="text-sm text-slate-400">—</span>
          </div>
        </div>

        <div>
          <p class="text-[11px] font-medium uppercase tracking-wide text-slate-500">Notas</p>
          <textarea
            class="mt-2 min-h-24 w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            placeholder="Anotações sobre o atendimento (em breve: persistência)"
          />
        </div>
      </div>
    </div>

    <EmptyState
      v-else
      class="m-4"
      icon="i-lucide-user-round"
      title="Selecione uma conversa"
      description="Os dados do contato aparecem aqui."
    />
  </aside>
</template>
