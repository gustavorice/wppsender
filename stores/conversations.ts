import { defineStore } from 'pinia'
import type { Conversation, Message } from '~~/types/entities'

let pendingSortTimer: ReturnType<typeof setTimeout> | null = null

// Stable comparator: which of two conversation rows referring to the same
// contact is "more recent"? Prefers last_message_at, then updated_at, then
// created_at. Defensive against the DB sometimes having dup rows for the
// same (org, account, contact) tuple while the dedupe migration is in flight.
function conversationFreshness(c: Conversation): number {
  const lm = c.last_message_at ? new Date(c.last_message_at).getTime() : 0
  if (lm > 0) return lm
  const up = c.updated_at ? new Date(c.updated_at).getTime() : 0
  if (up > 0) return up
  const cr = c.created_at ? new Date(c.created_at).getTime() : 0
  return cr
}

// Pick the contact key we group by. Falls back through contact.id, wa_id,
// and finally contact_id so a row missing the joined contact still groups
// with its sibling row that has the join hydrated.
function contactKey(c: Conversation): string {
  return c.contact?.id || c.contact?.wa_id || c.contact_id || c.id
}

// Reduce a list of conversations to one row per contact, keeping the freshest
// and preserving the relative order of survivors.
function dedupeByContact(rows: Conversation[]): Conversation[] {
  const winnerByKey = new Map<string, Conversation>()
  for (const row of rows) {
    const key = contactKey(row)
    const current = winnerByKey.get(key)
    if (!current) {
      winnerByKey.set(key, row)
      continue
    }
    const currentTs = conversationFreshness(current)
    const incomingTs = conversationFreshness(row)
    if (incomingTs > currentTs) {
      // Merge: take the newer row but keep any joined data from the older
      // one if the newer row is missing it (Realtime INSERTs arrive without
      // joins).
      winnerByKey.set(key, {
        ...current,
        ...row,
        contact: row.contact || current.contact,
        whatsapp_account: row.whatsapp_account || current.whatsapp_account,
        last_message: row.last_message || current.last_message
      })
    } else {
      winnerByKey.set(key, {
        ...row,
        ...current,
        contact: current.contact || row.contact,
        whatsapp_account: current.whatsapp_account || row.whatsapp_account,
        last_message: current.last_message || row.last_message
      })
    }
  }
  // Preserve the order of first occurrence so unaffected rows don't shuffle.
  const seen = new Set<string>()
  const out: Conversation[] = []
  for (const row of rows) {
    const key = contactKey(row)
    if (seen.has(key)) continue
    seen.add(key)
    const winner = winnerByKey.get(key)
    if (winner) out.push(winner)
  }
  return out
}

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
      // Defensive UI-level dedupe: even if the backend returns duplicate rows
      // for the same contact (the DB cleanup migration is happening separately),
      // we collapse them into one canonical row in the store. Without this the
      // inbox can show two rows for "Joao" both pointing at the same number.
      const deduped = dedupeByContact(conversations)
      this.conversations = deduped
      const firstConversation = deduped[0]
      if (!this.activeConversationId && firstConversation) {
        this.activeConversationId = firstConversation.id
      } else if (this.activeConversationId && !deduped.some((c) => c.id === this.activeConversationId)) {
        // If the active id got dedupe-folded into another row, switch to the
        // surviving row for the same contact so the user doesn't lose context.
        const previous = conversations.find((c) => c.id === this.activeConversationId)
        if (previous) {
          const survivor = deduped.find((c) => contactKey(c) === contactKey(previous))
          if (survivor) this.activeConversationId = survivor.id
        }
      }
    },
    setActiveConversation(id: string | null) {
      this.activeConversationId = id
    },
    upsertConversation(conversation: Conversation) {
      const index = this.conversations.findIndex((item) => item.id === conversation.id)
      const incomingTs = conversation.last_message_at ? new Date(conversation.last_message_at).getTime() : 0

      if (index >= 0) {
        const current = this.conversations[index] || conversation
        const currentTs = current.last_message_at ? new Date(current.last_message_at).getTime() : 0
        // Merge: keep joined relations from whichever side has them. A pure
        // postgres_changes payload arrives WITHOUT contact/whatsapp_account/
        // last_message, so preserving the existing joins is essential to
        // avoid the row going "blank" mid-conversation.
        const merged: Conversation = {
          ...current,
          ...conversation,
          contact: conversation.contact || current.contact,
          whatsapp_account: conversation.whatsapp_account || current.whatsapp_account,
          last_message: conversation.last_message || current.last_message
        }

        // If timestamp didn't move forward, merge in place without re-sorting —
        // avoids the inbox flicker when CONTACTS_UPSERT / status updates fire
        // hundreds of times during a history sync.
        this.conversations.splice(index, 1, merged)
        if (incomingTs > currentTs) {
          this.scheduleSort()
        }
        return
      }

      // No existing row with this id. But there might be a sibling row for the
      // SAME contact (e.g. backend just deduped, or a join was hydrated under
      // a different conversation row). Collapse them.
      const incomingKey = contactKey(conversation)
      const siblingIndex = this.conversations.findIndex((c) => contactKey(c) === incomingKey)
      if (siblingIndex >= 0) {
        const sibling = this.conversations[siblingIndex]!
        const siblingTs = conversationFreshness(sibling)
        const incomingFreshness = conversationFreshness(conversation)
        if (incomingFreshness >= siblingTs) {
          // Incoming row is fresher: replace, keeping sibling's joins as fallback.
          const merged: Conversation = {
            ...sibling,
            ...conversation,
            contact: conversation.contact || sibling.contact,
            whatsapp_account: conversation.whatsapp_account || sibling.whatsapp_account,
            last_message: conversation.last_message || sibling.last_message
          }
          this.conversations.splice(siblingIndex, 1, merged)
          // If the sibling was active, point active at the new id.
          if (this.activeConversationId === sibling.id) {
            this.activeConversationId = merged.id
          }
          if (incomingTs > siblingTs) this.scheduleSort()
        }
        // If sibling is fresher, drop the incoming row entirely.
        return
      }

      this.conversations.unshift(conversation)
      this.scheduleSort()
    },
    updateLastMessage(message: Message) {
      const conversation = this.conversations.find((item) => item.id === message.conversation_id)
      if (!conversation) {
        return
      }

      conversation.last_message = message
      conversation.last_message_at = message.sent_at || message.created_at
      this.scheduleSort()
    },
    removeConversation(id: string) {
      const idx = this.conversations.findIndex((c) => c.id === id)
      if (idx >= 0) {
        this.conversations.splice(idx, 1)
        if (this.activeConversationId === id) {
          this.activeConversationId = this.conversations[0]?.id || null
        }
      }
    },
    scheduleSort() {
      if (pendingSortTimer) return
      pendingSortTimer = setTimeout(() => {
        pendingSortTimer = null
        this.sortByLastMessage()
      }, 250)
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
