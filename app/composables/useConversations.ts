import type { ApiListResponse, Conversation } from '~~/types/entities'
import { useConversationsStore } from '~~/stores/conversations'

interface FetchConversationOptions {
  search?: string
  whatsappAccountId?: string | null
}

export function useConversations() {
  const store = useConversationsStore()

  async function fetchConversations(options: FetchConversationOptions = {}) {
    store.loading = true
    try {
      const response = await $fetch<ApiListResponse<Conversation>>('/api/conversations', {
        query: {
          search: options.search || undefined,
          whatsapp_account_id: options.whatsappAccountId || undefined
        }
      })

      store.setConversations(response.data)
      return response.data
    } finally {
      store.loading = false
    }
  }

  return {
    store,
    conversations: computed(() => store.conversations),
    loading: computed(() => store.loading),
    activeConversation: computed(() => store.activeConversation),
    activeConversationId: computed({
      get: () => store.activeConversationId,
      set: (value) => store.setActiveConversation(value)
    }),
    fetchConversations
  }
}
