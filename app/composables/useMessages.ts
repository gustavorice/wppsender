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

      // If this conversation has no local history yet, ask the server to
      // pull the last ~150 messages from Evolution's stored history. The
      // sync persists everything in Postgres and the Realtime channel /
      // subsequent fetch will surface them.
      if (response.data.length === 0) {
        try {
          const sync = await $fetch<{ data: { synced: number } }>(`/api/conversations/${conversationId}/sync-history`, {
            method: 'POST'
          })
          if (sync.data?.synced > 0) {
            const refreshed = await $fetch<ApiListResponse<Message>>(`/api/messages/${conversationId}`)
            store.setMessages(conversationId, refreshed.data)
            return refreshed.data
          }
        } catch {
          // history sync is best-effort; never block the inbox
        }
      }

      return response.data
    } finally {
      store.loadingConversationId = null
    }
  }

  // Polling fallback for the case where the Supabase Realtime channel is
  // not delivering postgres_changes (eg. Clerk JWT not yet refreshed, TPA
  // misconfig on a temporary basis, browser tab in background). Every 5s
  // we re-fetch the active conversation messages; new rows merge into the
  // store via `setMessages` which dedupes.
  function startPolling(conversationIdRef: { value: string | null | undefined }, intervalMs = 5000) {
    let timer: ReturnType<typeof setInterval> | null = null
    const tick = async () => {
      const id = conversationIdRef.value
      if (!id) return
      try {
        const response = await $fetch<ApiListResponse<Message>>(`/api/messages/${id}`)
        store.setMessages(id, response.data)
      } catch {
        // ignore transient errors
      }
    }
    timer = setInterval(tick, intervalMs)
    return () => {
      if (timer) clearInterval(timer)
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
    sendMessage,
    startPolling
  }
}
