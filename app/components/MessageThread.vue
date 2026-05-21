<script setup lang="ts">
import type { Conversation, Contact, Message } from '~~/types/entities'
import { contactDisplayName, contactPhoneLabel, avatarColor, contactInitial } from '~/utils/phone'
import { useConversationsStore } from '~~/stores/conversations'

const props = defineProps<{
  conversation: Conversation | null
  messages: Message[]
  loading?: boolean
}>()

const threadEl = ref<HTMLElement | null>(null)
const toast = useToast()
const conversationsStore = useConversationsStore()

const editingName = ref(false)
const nameDraft = ref('')
const savingName = ref(false)

// Treat a contact as "unnamed" when neither the agenda name nor the WhatsApp
// pushName is set. These are the LIDs Evolution couldn't identify (people
// the user messaged who never replied with a known phone). The UI surfaces
// an inline banner so the user can name them once and forget.
const isUnnamed = computed(() => {
  const c = props.conversation?.contact
  if (!c) return false
  return !c.name?.trim() && !c.push_name?.trim()
})

function startEditName() {
  nameDraft.value = props.conversation?.contact?.name || ''
  editingName.value = true
}

async function commitName() {
  const id = props.conversation?.contact?.id
  const name = nameDraft.value.trim()
  if (!id || !name) {
    editingName.value = false
    return
  }
  savingName.value = true
  try {
    const response = await $fetch<{ data: Contact }>(`/api/contacts/${id}`, {
      method: 'PATCH',
      body: { name }
    })
    if (props.conversation) {
      conversationsStore.upsertConversation({
        ...props.conversation,
        contact: { ...(props.conversation.contact || {}), ...response.data }
      } as Conversation)
    }
    editingName.value = false
    toast.add({ title: 'Contato renomeado', color: 'success' })
  } catch (err) {
    toast.add({
      title: 'Falha ao renomear',
      description: err instanceof Error ? err.message : 'Tente novamente.',
      color: 'error'
    })
  } finally {
    savingName.value = false
  }
}

function cancelEditName() {
  editingName.value = false
  nameDraft.value = ''
}

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
      <div v-if="conversation" class="group flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <div class="h-9 w-9 shrink-0 overflow-hidden rounded-full">
            <img
              v-if="conversation.contact?.avatar_url"
              :src="conversation.contact.avatar_url"
              :alt="conversation.contact?.name || ''"
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
            <div v-if="!editingName" class="flex items-center gap-1">
              <h2 class="truncate text-sm font-semibold text-slate-950">
                {{ contactDisplayName(conversation.contact) }}
              </h2>
              <button
                type="button"
                class="shrink-0 rounded p-0.5 text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Renomear contato"
                title="Renomear contato"
                @click="startEditName"
              >
                <UIcon name="i-lucide-pencil" class="h-3.5 w-3.5" />
              </button>
            </div>
            <div v-else class="flex items-center gap-1">
              <UInput
                v-model="nameDraft"
                size="xs"
                class="min-w-0 flex-1"
                :disabled="savingName"
                placeholder="Nome do contato"
                autofocus
                @keydown.enter="commitName"
                @keydown.escape="cancelEditName"
              />
              <UButton size="xs" color="success" :loading="savingName" @click="commitName">
                <UIcon name="i-lucide-check" class="h-3.5 w-3.5" />
              </UButton>
              <UButton size="xs" variant="ghost" color="neutral" :disabled="savingName" @click="cancelEditName">
                <UIcon name="i-lucide-x" class="h-3.5 w-3.5" />
              </UButton>
            </div>
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
    <template v-else>
      <div
        v-if="isUnnamed && !editingName"
        class="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900"
      >
        <div class="flex items-center justify-between gap-3">
          <span class="flex items-center gap-1.5">
            <UIcon name="i-lucide-info" class="h-3.5 w-3.5" />
            Este contato não tem nome salvo. Renomeie para identificar fácil na lista.
          </span>
          <UButton size="xs" color="warning" variant="soft" icon="i-lucide-pencil" @click="startEditName">
            Renomear
          </UButton>
        </div>
      </div>

      <div ref="threadEl" class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-5">
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
          <MessageMedia
            v-else-if="['image','audio','video','document'].includes(message.type)"
            :message="message"
          />
          <p v-else class="whitespace-pre-wrap text-sm leading-6">{{ message.body || '[mensagem]' }}</p>
          <p class="mt-1 flex items-center justify-end gap-1 text-[11px]" :class="message.direction === 'outbound' && !message.deleted_at && message.status !== 'failed' ? 'text-emerald-50' : 'text-slate-500'">
            {{ new Date(message.sent_at || message.created_at).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }}
            <UIcon v-if="message.direction === 'outbound' && message.status === 'pending'" name="i-lucide-clock-3" class="h-3 w-3" />
            <UIcon v-else-if="message.direction === 'outbound' && message.status === 'failed'" name="i-lucide-alert-circle" class="h-3 w-3" />
            <UIcon v-else-if="message.direction === 'outbound' && !message.deleted_at" name="i-lucide-check" class="h-3 w-3" />
          </p>
        </div>
      </div>
      </div>
    </template>

    <MessageComposer v-if="conversation" :conversation="conversation" />
  </section>
</template>
