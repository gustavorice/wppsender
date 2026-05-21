import type { RealtimeChannel } from '@supabase/supabase-js'
import type { Conversation, WhatsAppAccount, Message } from '~~/types/entities'
import { useConversationsStore } from '~~/stores/conversations'
import { useWhatsappAccountsStore } from '~~/stores/whatsappAccounts'

// Realtime postgres_changes payloads ONLY contain the raw new row — never the
// joined relations (contact, whatsapp_account, last_message). If we feed that
// straight into the store, the inbox row goes "blank" the instant a webhook
// touches the conversation (no name, no avatar, no last message). So when an
// INSERT/UPDATE arrives we kick off a hydrated fetch for that specific row
// and only then upsert the fully-formed conversation into the store.
//
// For new messages: subscribe to ALL inbound message INSERTs in this tenant,
// not just the active conversation. Even a chat that isn't currently selected
// must bump to the top of the inbox the moment a message lands.
export function useRealtimeConversations() {
  const nuxtApp = useNuxtApp()
  const conversationsStore = useConversationsStore()
  const accountsStore = useWhatsappAccountsStore()
  const { organizationId } = useCurrentOrganization()
  const instanceId = Math.random().toString(36).slice(2, 10)
  let conversationsChannel: RealtimeChannel | null = null
  let accountsChannel: RealtimeChannel | null = null
  let messagesChannel: RealtimeChannel | null = null

  async function cleanup() {
    if (conversationsChannel) {
      await nuxtApp.$supabase.removeChannel(conversationsChannel)
      conversationsChannel = null
    }
    if (accountsChannel) {
      await nuxtApp.$supabase.removeChannel(accountsChannel)
      accountsChannel = null
    }
    if (messagesChannel) {
      await nuxtApp.$supabase.removeChannel(messagesChannel)
      messagesChannel = null
    }
  }

  async function hydrateAndUpsert(conversationId: string) {
    try {
      const { data } = await nuxtApp.$supabase
        .from('conversations')
        .select('*, contact:contacts(*), whatsapp_account:whatsapp_accounts(id, display_name, phone_number, status)')
        .eq('id', conversationId)
        .maybeSingle()
      if (!data) return
      // Also fetch the most recent message for the inbox preview.
      const { data: lastMsg } = await nuxtApp.$supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('sent_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const conv: Conversation = { ...(data as any), last_message: lastMsg || null }
      conversationsStore.upsertConversation(conv)
    } catch {
      // Realtime is best-effort; ignore transient errors. The store still has
      // whatever it had before, and the polling fallback will catch up.
    }
  }

  watch(
    organizationId,
    async (orgId) => {
      await cleanup()
      if (!orgId) return

      conversationsChannel = nuxtApp.$supabase
        .channel(`conversations:${orgId}:${instanceId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'conversations',
            filter: `clerk_org_id=eq.${orgId}`
          },
          (payload) => {
            const row = (payload.new || payload.old) as { id?: string } | null
            if (row?.id) void hydrateAndUpsert(row.id)
          }
        )
        .subscribe()

      accountsChannel = nuxtApp.$supabase
        .channel(`whatsapp-accounts:${orgId}:${instanceId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'whatsapp_accounts',
            filter: `clerk_org_id=eq.${orgId}`
          },
          (payload) => {
            accountsStore.upsertAccount(payload.new as WhatsAppAccount)
          }
        )
        .subscribe()

      // Listen to message INSERTs across the whole tenant so a chat that isn't
      // currently selected still bumps to the top of the inbox the moment a
      // message arrives. The active-conversation channel in useRealtimeMessages
      // handles in-thread rendering; this one only refreshes the list row.
      messagesChannel = nuxtApp.$supabase
        .channel(`messages:tenant:${orgId}:${instanceId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `clerk_org_id=eq.${orgId}`
          },
          (payload) => {
            const m = payload.new as Message | null
            if (!m) return
            // Quick path: if the conversation already exists in the store,
            // just bump its last_message and re-sort. No network roundtrip.
            const existing = conversationsStore.conversations.find((c) => c.id === m.conversation_id)
            if (existing) {
              conversationsStore.updateLastMessage(m)
              return
            }
            // Otherwise the conversation is new to us — hydrate the join.
            void hydrateAndUpsert(m.conversation_id)
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
