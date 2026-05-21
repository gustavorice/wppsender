import { defineStore } from 'pinia'
import type { Message } from '~~/types/entities'

// Resolve a message's sort timestamp. Prefers WhatsApp's delivery time
// (sent_at); falls back to local insert time (created_at). Rows missing
// both end up at the bottom — keeping optimistic outbound at the end of
// the list even before the server echoes back.
function messageTs(m: Message): number {
  const raw = m.sent_at || m.created_at
  if (!raw) return Number.POSITIVE_INFINITY
  const t = new Date(raw).getTime()
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
}

export const useMessagesStore = defineStore('messages', {
  state: () => ({
    byConversationId: {} as Record<string, Message[]>,
    loadingConversationId: null as string | null,
    sending: false
  }),
  actions: {
    setMessages(conversationId: string, messages: Message[]) {
      // Preserve any local 'pending' rows that the server hasn't echoed yet.
      const existing = this.byConversationId[conversationId] || []
      const pending = existing.filter((m) => m.status === 'pending')
      const serverIds = new Set(messages.map((m) => m.wa_message_id).filter(Boolean))
      const survivingPending = pending.filter((p) => p.wa_message_id && !serverIds.has(p.wa_message_id))
      const merged = [...messages, ...survivingPending].sort((a, b) => {
        const aTs = messageTs(a)
        const bTs = messageTs(b)
        return aTs - bTs
      })
      this.byConversationId[conversationId] = merged
    },
    addMessage(message: Message) {
      const current = this.byConversationId[message.conversation_id] || []
      // Dedup by id OR wa_message_id — handles the case where the server
      // echo arrives after we already inserted an optimistic local copy.
      const idx = current.findIndex((item) =>
        item.id === message.id ||
        (message.wa_message_id && item.wa_message_id === message.wa_message_id)
      )
      if (idx >= 0) {
        // Replace the local pending row with the server's authoritative one.
        const updated = [...current]
        updated[idx] = { ...current[idx], ...message }
        this.byConversationId[message.conversation_id] = updated
        return
      }
      this.byConversationId[message.conversation_id] = [...current, message].sort((a, b) => {
        const aTs = messageTs(a)
        const bTs = messageTs(b)
        return aTs - bTs
      })
    },
    addOptimistic(message: Message) {
      const current = this.byConversationId[message.conversation_id] || []
      this.byConversationId[message.conversation_id] = [...current, message]
    },
    replaceByLocalId(localId: string, real: Message) {
      const current = this.byConversationId[real.conversation_id] || []
      const idx = current.findIndex((m) => m.id === localId)
      if (idx >= 0) {
        const updated = [...current]
        updated[idx] = real
        this.byConversationId[real.conversation_id] = updated
      } else {
        this.addMessage(real)
      }
    },
    markFailed(localId: string, conversationId: string) {
      const current = this.byConversationId[conversationId] || []
      const idx = current.findIndex((m) => m.id === localId)
      if (idx >= 0) {
        const updated = [...current]
        updated[idx] = { ...current[idx], status: 'failed' } as Message
        this.byConversationId[conversationId] = updated
      }
    },
    replaceMessage(message: Message) {
      const current = this.byConversationId[message.conversation_id] || []
      const index = current.findIndex((item) => item.id === message.id)

      if (index >= 0) {
        current[index] = message
        this.byConversationId[message.conversation_id] = [...current]
      } else {
        this.addMessage(message)
      }
    }
  }
})
