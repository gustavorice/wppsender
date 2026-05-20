<script setup lang="ts">
definePageMeta({ layout: 'private' })

const { fetchAccounts, accounts } = useWhatsappAccounts()
const {
  fetchConversations,
  openConversationForContact,
  conversations,
  orphanContacts,
  activeConversation,
  activeConversationId,
  loading
} = useConversations()
const { fetchMessages, messagesForConversation, store: messagesStore } = useMessages()

useRealtimeConversations()
useRealtimeMessages(activeConversationId)

const toast = useToast()
const activeMessages = computed(() => messagesForConversation(activeConversationId.value).value)
const messageLoading = computed(() => messagesStore.loadingConversationId === activeConversationId.value)

async function selectConversation(id: string) {
  activeConversationId.value = id
  await fetchMessages(id)
}

async function selectContact(contactId: string) {
  try {
    const conv = await openConversationForContact(contactId)
    await fetchMessages(conv.id)
  } catch (err) {
    toast.add({
      title: 'Nao foi possivel abrir conversa',
      description: err instanceof Error ? err.message : 'Tente novamente.',
      color: 'error'
    })
  }
}

async function filterConversations(payload: { search: string; whatsappAccountId: string | null }) {
  await fetchConversations(payload)
}

watch(
  activeConversationId,
  async (id) => {
    if (id && !messagesStore.byConversationId[id]) {
      await fetchMessages(id)
    }
  },
  { immediate: false }
)

onMounted(async () => {
  await Promise.all([fetchAccounts(), fetchConversations()])
  if (activeConversationId.value) {
    await fetchMessages(activeConversationId.value)
  }
})
</script>

<template>
  <div class="grid h-[calc(100vh-120px)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)_320px]">
    <ConversationList
      :conversations="conversations"
      :orphan-contacts="orphanContacts"
      :accounts="accounts"
      :active-conversation-id="activeConversationId"
      :loading="loading"
      @select="selectConversation"
      @select-contact="selectContact"
      @filter="filterConversations"
    />
    <MessageThread :conversation="activeConversation" :messages="activeMessages" :loading="messageLoading" />
    <ContactSidebar :conversation="activeConversation" />
  </div>
</template>
