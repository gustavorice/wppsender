import { getQuery } from 'h3'
import { getServerSupabase } from '~~/server/utils/supabase'
import { requireTenantAuth } from '~~/server/utils/auth'
import { normalizeError } from '~~/server/utils/errors'
import type { Conversation, Contact, Message, WhatsAppAccount } from '~~/types/entities'

export default defineEventHandler(async (event) => {
  try {
    const tenant = requireTenantAuth(event)
    const query = getQuery(event)
    const whatsappAccountId = typeof query.whatsapp_account_id === 'string' ? query.whatsapp_account_id : ''
    const search = typeof query.search === 'string' ? query.search.trim() : ''
    const supabase = getServerSupabase()

    // 1. Conversations with last message
    let request = supabase
      .from('conversations')
      .select('*, contact:contacts(*), whatsapp_account:whatsapp_accounts(id, display_name, phone_number, status)')
      .eq('clerk_org_id', tenant.orgId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(200)

    if (whatsappAccountId) {
      request = request.eq('whatsapp_account_id', whatsappAccountId)
    }

    const { data, error } = await request
    if (error) throw error

    const allConversations = (data || []) as unknown as Conversation[]

    const term = search.toLowerCase()
    const matchesSearch = (c: Pick<Contact, 'name' | 'phone' | 'wa_id'> | null | undefined): boolean => {
      if (!term) return true
      if (!c) return false
      return (
        Boolean(c.name?.toLowerCase().includes(term)) ||
        Boolean(c.phone?.includes(term)) ||
        Boolean(c.wa_id?.includes(term))
      )
    }

    const filteredConversations = allConversations.filter((conversation) => matchesSearch(conversation.contact))

    // 2. Hydrate with last message
    const ids = filteredConversations.map((c) => c.id)
    let lastMessages: Message[] = []
    if (ids.length > 0) {
      const { data: messages } = await supabase
        .from('messages')
        .select('*')
        .eq('clerk_org_id', tenant.orgId)
        .in('conversation_id', ids)
        .order('sent_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })

      const seen = new Set<string>()
      lastMessages = ((messages || []) as Message[]).filter((m) => {
        if (seen.has(m.conversation_id)) return false
        seen.add(m.conversation_id)
        return true
      })
    }

    const hydrated = filteredConversations.map((conversation) => {
      const last_message = lastMessages.find((m) => m.conversation_id === conversation.id) || null

      // Defensive: most BR conversations have NULL last_message_at while the
      // backfill is still in progress. Promote the most recent message's
      // sent_at (or created_at fallback) so the UI sorts/displays the real
      // most recent timestamp instead of NULL.
      const currentTs = conversation.last_message_at ? new Date(conversation.last_message_at).getTime() : 0
      const messageRaw = last_message ? (last_message.sent_at || last_message.created_at) : null
      const messageTs = messageRaw ? new Date(messageRaw).getTime() : 0
      const effectiveTs = Math.max(currentTs, Number.isNaN(messageTs) ? 0 : messageTs)
      const last_message_at = effectiveTs > 0 ? new Date(effectiveTs).toISOString() : conversation.last_message_at

      return {
        ...conversation,
        last_message_at,
        last_message
      }
    })

    // 3. Contacts WITHOUT a conversation yet (so the inbox lists everyone
    // from the address book, not just people who already messaged you).
    const contactsWithConv = new Set(allConversations.map((c) => c.contact_id))

    let contactQuery = supabase
      .from('contacts')
      .select('*, whatsapp_account:whatsapp_accounts(id, display_name, phone_number, status)')
      .eq('clerk_org_id', tenant.orgId)
      .order('name', { ascending: true, nullsFirst: false })
      .limit(500)

    if (whatsappAccountId) {
      contactQuery = contactQuery.eq('whatsapp_account_id', whatsappAccountId)
    }

    const { data: contactRows, error: contactErr } = await contactQuery
    if (contactErr) throw contactErr

    const orphanContacts = (contactRows || []).filter((c: any) => !contactsWithConv.has(c.id) && matchesSearch(c)) as Array<Contact & {
      whatsapp_account?: Pick<WhatsAppAccount, 'id' | 'display_name' | 'phone_number' | 'status'> | null
    }>

    // Return both lists. Frontend renders conversations first, then a
    // "Outros contatos" section for the rest.
    return {
      data: hydrated,
      contacts_without_conversation: orphanContacts
    }
  } catch (error) {
    throw normalizeError(error)
  }
})
