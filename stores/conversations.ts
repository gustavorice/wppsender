import { defineStore } from 'pinia'
import type { Conversation, Message } from '~~/types/entities'

export const useConversationsStore = defineStore('conversations', {
  state: () => ({
    conversations: [] as Conversation[],
    activeConversationId: null as string | null,
    loading: false
  }),
  getters: {
    activeConversation: (state) => state.conversations.find((conversation) => conversation.id === state.activeConversationId) || null
  },
  actions: {
    setConversations(conversations: Conversation[]) {
      this.conversations = conversations
      const firstConversation = conversations[0]
      if (!this.activeConversationId && firstConversation) {
        this.activeConversationId = firstConversation.id
      }
    },
    setActiveConversation(id: string | null) {
      this.activeConversationId = id
    },
    upsertConversation(conversation: Conversation) {
      const index = this.conversations.findIndex((item) => item.id === conversation.id)

      if (index >= 0) {
        const current = this.conversations[index] || conversation
        this.conversations.splice(index, 1, {
          ...current,
          ...conversation
        })
      } else {
        this.conversations.unshift(conversation)
      }

      this.sortByLastMessage()
    },
    updateLastMessage(message: Message) {
      const conversation = this.conversations.find((item) => item.id === message.conversation_id)
      if (!conversation) {
        return
      }

      conversation.last_message = message
      conversation.last_message_at = message.sent_at || message.created_at
      this.sortByLastMessage()
    },
    sortByLastMessage() {
      this.conversations.sort((a, b) => {
        const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
        const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
        return bTime - aTime
      })
    }
  }
})
