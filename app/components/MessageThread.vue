<script setup lang="ts">
import type { Conversation, Message } from '~~/types/entities'
import { contactDisplayName, contactPhoneLabel } from '~/utils/phone'

const props = defineProps<{
  conversation: Conversation | null
  messages: Message[]
  loading?: boolean
}>()

const threadEl = ref<HTMLElement | null>(null)

const { isTyping, isRecording } = useTypingIndicator(
  () => props.conversation?.whatsapp_account_id ?? null,
  () => props.conversation?.contact?.wa_id ?? null
)

const presenceLabel = computed(() => {
  if (isRecording.value) return 'gravando áudio…'
  if (isTyping.value) return 'digitando…'
  return ''
})

watch(
  () => threadEl.value?.scrollHeight,
  async () => {
    await nextTick()
    if (threadEl.value) {
      threadEl.value.scrollTop = threadEl.value.scrollHeight
    }
  }
)
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-slate-50">
    <div class="border-b border-slate-200 bg-white px-4 py-3">
      <div v-if="conversation" class="flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <div class="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-slate-100">
            <img
              v-if="conversation.contact?.avatar_url"
              :src="conversation.contact.avatar_url"
              :alt="conversation.contact?.name || ''"
              class="h-full w-full object-cover"
              loading="lazy"
              @error="(e: Event) => { const target = e.target as HTMLImageElement; target.style.display = 'none' }"
            />
            <div v-else class="flex h-full w-full items-center justify-center text-sm font-semibold text-slate-700">
              {{ (conversation.contact?.name || conversation.contact?.phone || '?').slice(0, 1).toUpperCase() }}
            </div>
          </div>
          <div class="min-w-0">
            <h2 class="truncate text-sm font-semibold text-slate-950">
              {{ contactDisplayName(conversation.contact) }}
            </h2>
            <p v-if="presenceLabel" class="truncate text-xs font-medium text-emerald-600">
              {{ presenceLabel }}
            </p>
            <p v-else-if="contactPhoneLabel(conversation.contact)" class="truncate text-xs text-slate-500">
              {{ contactPhoneLabel(conversation.contact) }}
            </p>
          </div>
        </div>
        <UBadge variant="soft" color="success">{{ conversation.status }}</UBadge>
      </div>
      <p v-else class="text-sm font-medium text-slate-600">Selecione uma conversa</p>
    </div>

    <div
      v-if="loading"
      class="min-h-0 flex-1 space-y-3 overflow-hidden px-4 py-5"
      aria-busy="true"
      aria-label="Carregando mensagens"
    >
      <div
        v-for="(skeleton, idx) in [
          { side: 'left', width: 'w-3/5' },
          { side: 'right', width: 'w-2/5' },
          { side: 'left', width: 'w-1/2' },
          { side: 'right', width: 'w-3/5' },
          { side: 'left', width: 'w-2/5' }
        ]"
        :key="`skeleton-msg-${idx}`"
        class="flex"
        :class="skeleton.side === 'right' ? 'justify-end' : 'justify-start'"
      >
        <div class="max-w-[78%] space-y-2 rounded-lg px-3 py-2 shadow-sm" :class="skeleton.side === 'right' ? 'bg-emerald-100' : 'border border-slate-200 bg-white'">
          <div class="h-3 animate-pulse rounded-md bg-slate-200" :class="skeleton.width" />
          <div class="h-3 w-24 animate-pulse rounded-md bg-slate-200" />
          <div class="ml-auto h-2 w-10 animate-pulse rounded-md bg-slate-200" />
        </div>
      </div>
    </div>
    <EmptyState
      v-else-if="!conversation"
      class="m-4"
      icon="i-lucide-message-square"
      title="Nenhuma conversa selecionada"
      description="Escolha uma conversa na lista para ler e responder."
    />
    <div v-else ref="threadEl" class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-5">
      <div
        v-for="message in messages"
        :key="message.id"
        class="flex"
        :class="message.direction === 'outbound' ? 'justify-end' : 'justify-start'"
      >
        <div
          class="max-w-[78%] rounded-lg px-3 py-2 shadow-sm"
          :class="[
            message.direction === 'outbound' ? 'bg-emerald-600 text-white' : 'border border-slate-200 bg-white text-slate-900',
            message.status === 'pending' ? 'opacity-70' : '',
            message.status === 'failed' ? 'border border-red-300 bg-red-50 text-red-900' : ''
          ]"
        >
          <p v-if="message.deleted_at" class="whitespace-pre-wrap text-sm italic leading-6 opacity-80">
            <UIcon name="i-lucide-ban" class="-mt-0.5 mr-1 inline h-3.5 w-3.5" />Esta mensagem foi apagada
          </p>
          <p v-else class="whitespace-pre-wrap text-sm leading-6">{{ message.body || '[midia]' }}</p>
          <p class="mt-1 flex items-center justify-end gap-1 text-[11px]" :class="message.direction === 'outbound' && !message.deleted_at && message.status !== 'failed' ? 'text-emerald-50' : 'text-slate-500'">
            {{ new Date(message.sent_at || message.created_at).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }}
            <UIcon v-if="message.direction === 'outbound' && message.status === 'pending'" name="i-lucide-clock-3" class="h-3 w-3" />
            <UIcon v-else-if="message.direction === 'outbound' && message.status === 'failed'" name="i-lucide-alert-circle" class="h-3 w-3" />
            <UIcon v-else-if="message.direction === 'outbound' && !message.deleted_at" name="i-lucide-check" class="h-3 w-3" />
          </p>
        </div>
      </div>
    </div>

    <MessageComposer v-if="conversation" :conversation="conversation" />
  </section>
</template>
