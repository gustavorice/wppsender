<script setup lang="ts">
import type { Conversation, Contact } from '~~/types/entities'
import { contactDisplayName, contactPhoneLabel, formatPhone, avatarColor, contactInitial } from '~/utils/phone'
import { useConversationsStore } from '~~/stores/conversations'

const props = defineProps<{
  conversation: Conversation | null
}>()

const toast = useToast()
const conversationsStore = useConversationsStore()

const editing = ref(false)
const draft = ref('')
const saving = ref(false)

const waLink = computed(() => {
  const phone = props.conversation?.contact?.phone || props.conversation?.contact?.wa_id
  if (!phone) return null
  if (!formatPhone(phone)) return null
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

function startEdit() {
  draft.value = props.conversation?.contact?.name || ''
  editing.value = true
}

async function saveName() {
  const contactId = props.conversation?.contact?.id
  if (!contactId) return
  const name = draft.value.trim()
  if (!name) {
    editing.value = false
    return
  }
  saving.value = true
  try {
    const response = await $fetch<{ data: Contact }>(`/api/contacts/${contactId}`, {
      method: 'PATCH',
      body: { name }
    })
    // Update the conversation in the store so the inbox reflects the new name
    if (props.conversation) {
      const merged = { ...props.conversation, contact: { ...(props.conversation.contact || {}), ...response.data } }
      conversationsStore.upsertConversation(merged as Conversation)
    }
    editing.value = false
    toast.add({ title: 'Contato renomeado', color: 'success' })
  } catch (err) {
    toast.add({
      title: 'Nao foi possivel renomear',
      description: err instanceof Error ? err.message : 'Tente novamente.',
      color: 'error'
    })
  } finally {
    saving.value = false
  }
}

function cancelEdit() {
  editing.value = false
  draft.value = ''
}
</script>

<template>
  <aside class="hidden h-full min-h-0 overflow-y-auto border-l border-slate-200 bg-white xl:block">
    <div v-if="conversation" class="p-4">
      <div class="flex flex-col items-center text-center">
        <div class="h-20 w-20 overflow-hidden rounded-full">
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
            class="flex h-full w-full items-center justify-center text-2xl font-semibold"
            :class="avatarColor(conversation.contact?.wa_id)"
          >
            {{ contactInitial(conversation.contact) }}
          </div>
        </div>

        <div v-if="!editing" class="mt-3 flex items-center gap-1">
          <h3 class="truncate text-base font-semibold text-slate-950">
            {{ contactDisplayName(conversation.contact) }}
          </h3>
          <button
            type="button"
            class="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Renomear contato"
            @click="startEdit"
          >
            <UIcon name="i-lucide-pencil" class="h-3.5 w-3.5" />
          </button>
        </div>
        <div v-else class="mt-3 flex w-full items-center gap-1">
          <UInput
            v-model="draft"
            size="sm"
            class="flex-1"
            :disabled="saving"
            placeholder="Nome do contato"
            autofocus
            @keydown.enter="saveName"
            @keydown.escape="cancelEdit"
          />
          <UButton size="xs" variant="solid" color="success" :loading="saving" @click="saveName">
            <UIcon name="i-lucide-check" class="h-3.5 w-3.5" />
          </UButton>
          <UButton size="xs" variant="ghost" color="neutral" :disabled="saving" @click="cancelEdit">
            <UIcon name="i-lucide-x" class="h-3.5 w-3.5" />
          </UButton>
        </div>

        <p v-if="!editing && contactPhoneLabel(conversation.contact)" class="mt-0.5 text-xs text-slate-500">
          {{ contactPhoneLabel(conversation.contact) }}
        </p>
        <a
          v-if="waLink && !editing"
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
          <p class="text-[11px] font-medium uppercase tracking-wide text-slate-500">Número conectado</p>
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
