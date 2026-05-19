<script setup lang="ts">
import type { Conversation, Message } from '~~/types/entities'

defineProps<{
  conversation: Conversation | null
  messages: Message[]
  loading?: boolean
}>()

const threadEl = ref<HTMLElement | null>(null)

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
  <section class="flex min-h-[calc(100vh-120px)] flex-col bg-slate-50">
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
              {{ conversation.contact?.name || conversation.contact?.phone || 'Contato' }}
            </h2>
            <p class="truncate text-xs text-slate-500">{{ conversation.contact?.phone || conversation.contact?.wa_id }}</p>
          </div>
        </div>
        <UBadge variant="soft" color="success">{{ conversation.status }}</UBadge>
      </div>
      <p v-else class="text-sm font-medium text-slate-600">Selecione uma conversa</p>
    </div>

    <LoadingState v-if="loading" label="Carregando mensagens" />
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
          :class="message.direction === 'outbound' ? 'bg-emerald-600 text-white' : 'border border-slate-200 bg-white text-slate-900'"
        >
          <p class="whitespace-pre-wrap text-sm leading-6">{{ message.body || '[midia]' }}</p>
          <p class="mt-1 text-right text-[11px]" :class="message.direction === 'outbound' ? 'text-emerald-50' : 'text-slate-500'">
            {{ new Date(message.sent_at || message.created_at).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }}
          </p>
        </div>
      </div>
    </div>

    <MessageComposer v-if="conversation" :conversation="conversation" />
  </section>
</template>
