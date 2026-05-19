import { defineStore } from 'pinia'
import type { Message } from '~~/types/entities'

export const useMessagesStore = defineStore('messages', {
  state: () => ({
    byConversationId: {} as Record<string, Message[]>,
    loadingConversationId: null as string | null,
    sending: false
  }),
  actions: {
    setMessages(conversationId: string, messages: Message[]) {
      this.byConversationId[conversationId] = messages
    },
    addMessage(message: Message) {
      const current = this.byConversationId[message.conversation_id] || []
      if (current.some((item) => item.id === message.id || (message.wa_message_id && item.wa_message_id === message.wa_message_id))) {
        return
      }

      this.byConversationId[message.conversation_id] = [...current, message].sort((a, b) => {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      })
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
