import type { ApiItemResponse, ApiListResponse, Message } from '~~/types/entities'
import { useConversationsStore } from '~~/stores/conversations'
import { useMessagesStore } from '~~/stores/messages'

export function useMessages() {
  const store = useMessagesStore()
  const conversationsStore = useConversationsStore()
  const toast = useToast()

  async function fetchMessages(conversationId: string) {
    store.loadingConversationId = conversationId
    try {
      const response = await $fetch<ApiListResponse<Message>>(`/api/messages/${conversationId}`)
      store.setMessages(conversationId, response.data)
      return response.data
    } finally {
      store.loadingConversationId = null
    }
  }

  async function sendMessage(payload: { whatsapp_account_id: string; conversation_id: string; text: string }) {
    store.sending = true
    try {
      const response = await $fetch<ApiItemResponse<Message>>('/api/whatsapp/send-message', {
        method: 'POST',
        body: payload
      })

      store.addMessage(response.data)
      conversationsStore.updateLastMessage(response.data)
      return response.data
    } catch (error) {
      toast.add({
        title: 'Nao foi possivel enviar',
        description: error instanceof Error ? error.message : 'Tente novamente em instantes.',
        color: 'error'
      })
      throw error
    } finally {
      store.sending = false
    }
  }

  return {
    store,
    sending: computed(() => store.sending),
    messagesForConversation: (conversationId: string | null | undefined) =>
      computed(() => (conversationId ? store.byConversationId[conversationId] || [] : [])),
    fetchMessages,
    sendMessage
  }
}
