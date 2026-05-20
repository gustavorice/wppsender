import type { ApiListResponse, Conversation, Contact, WhatsAppAccount } from '~~/types/entities'
import { useConversationsStore } from '~~/stores/conversations'

interface FetchConversationOptions {
  search?: string
  whatsappAccountId?: string | null
}

type ContactStub = Contact & {
  whatsapp_account?: Pick<WhatsAppAccount, 'id' | 'display_name' | 'phone_number' | 'status'> | null
}

interface ConversationsResponse extends ApiListResponse<Conversation> {
  contacts_without_conversation: ContactStub[]
}

export function useConversations() {
  const store = useConversationsStore()
  const orphanContacts = ref<ContactStub[]>([])

  async function fetchConversations(options: FetchConversationOptions = {}) {
    store.loading = true
    try {
      const response = await $fetch<ConversationsResponse>('/api/conversations', {
        query: {
          search: options.search || undefined,
          whatsapp_account_id: options.whatsappAccountId || undefined
        }
      })

      store.setConversations(response.data)
      orphanContacts.value = response.contacts_without_conversation || []
      return response.data
    } finally {
      store.loading = false
    }
  }

  async function openConversationForContact(contactId: string): Promise<Conversation> {
    const response = await $fetch<{ data: Conversation }>('/api/conversations/open', {
      method: 'POST',
      body: { contact_id: contactId }
    })
    // Add to store so it shows up in the list immediately
    store.upsertConversation(response.data)
    store.setActiveConversation(response.data.id)
    orphanContacts.value = orphanContacts.value.filter((c) => c.id !== contactId)
    return response.data
  }

  return {
    store,
    conversations: computed(() => store.conversations),
    orphanContacts: computed(() => orphanContacts.value),
    loading: computed(() => store.loading),
    activeConversation: computed(() => store.activeConversation),
    activeConversationId: computed({
      get: () => store.activeConversationId,
      set: (value) => store.setActiveConversation(value)
    }),
    fetchConversations,
    openConversationForContact
  }
}
