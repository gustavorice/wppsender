import type { RealtimeChannel } from '@supabase/supabase-js'
import type { Conversation, WhatsAppAccount } from '~~/types/entities'
import { useConversationsStore } from '~~/stores/conversations'
import { useWhatsappAccountsStore } from '~~/stores/whatsappAccounts'

export function useRealtimeConversations() {
  const nuxtApp = useNuxtApp()
  const conversationsStore = useConversationsStore()
  const accountsStore = useWhatsappAccountsStore()
  const { organizationId } = useCurrentOrganization()
  let conversationsChannel: RealtimeChannel | null = null
  let accountsChannel: RealtimeChannel | null = null

  async function cleanup() {
    if (conversationsChannel) {
      await nuxtApp.$supabase.removeChannel(conversationsChannel)
      conversationsChannel = null
    }

    if (accountsChannel) {
      await nuxtApp.$supabase.removeChannel(accountsChannel)
      accountsChannel = null
    }
  }

  watch(
    organizationId,
    async (orgId) => {
      await cleanup()

      if (!orgId) {
        return
      }

      conversationsChannel = nuxtApp.$supabase
        .channel(`conversations:${orgId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'conversations',
            filter: `clerk_org_id=eq.${orgId}`
          },
          (payload) => {
            conversationsStore.upsertConversation(payload.new as Conversation)
          }
        )
        .subscribe()

      accountsChannel = nuxtApp.$supabase
        .channel(`whatsapp-accounts:${orgId}`)
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
    },
    { immediate: true }
  )

  onScopeDispose(() => {
    void cleanup()
  })
}
