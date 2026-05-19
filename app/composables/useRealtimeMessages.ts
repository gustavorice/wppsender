import type { RealtimeChannel } from '@supabase/supabase-js'
import type { Message } from '~~/types/entities'
import { useConversationsStore } from '~~/stores/conversations'
import { useMessagesStore } from '~~/stores/messages'

export function useRealtimeMessages(conversationId: MaybeRefOrGetter<string | null | undefined>) {
  const nuxtApp = useNuxtApp()
  const messagesStore = useMessagesStore()
  const conversationsStore = useConversationsStore()
  const instanceId = Math.random().toString(36).slice(2, 10)
  let channel: RealtimeChannel | null = null

  async function cleanup() {
    if (channel) {
      await nuxtApp.$supabase.removeChannel(channel)
      channel = null
    }
  }

  watch(
    () => toValue(conversationId),
    async (id) => {
      await cleanup()

      if (!id) {
        return
      }

      channel = nuxtApp.$supabase
        .channel(`messages:${id}:${instanceId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `conversation_id=eq.${id}`
          },
          (payload) => {
            const message = payload.new as Message
            messagesStore.addMessage(message)
            conversationsStore.updateLastMessage(message)
          }
        )
        .subscribe()
    },
    { immediate: true }
  )

  onScopeDispose(() => {
    void cleanup()
  })
}
