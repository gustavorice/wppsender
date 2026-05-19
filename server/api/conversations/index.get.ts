import { getQuery } from 'h3'
import { getServerSupabase } from '~~/server/utils/supabase'
import { requireTenantAuth } from '~~/server/utils/auth'
import { normalizeError } from '~~/server/utils/errors'
import type { Conversation, Message } from '~~/types/entities'

export default defineEventHandler(async (event) => {
  try {
    const tenant = requireTenantAuth(event)
    const query = getQuery(event)
    const whatsappAccountId = typeof query.whatsapp_account_id === 'string' ? query.whatsapp_account_id : ''
    const search = typeof query.search === 'string' ? query.search.trim() : ''
    const supabase = getServerSupabase()

    let request = supabase
      .from('conversations')
      .select('*, contact:contacts(*), whatsapp_account:whatsapp_accounts(id, display_name, phone_number, status)')
      .eq('clerk_org_id', tenant.orgId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(100)

    if (whatsappAccountId) {
      request = request.eq('whatsapp_account_id', whatsappAccountId)
    }

    const { data, error } = await request

    if (error) {
      throw error
    }

    const conversations = (data || []) as unknown as Conversation[]
    const filtered = search
      ? conversations.filter((conversation) => {
          const contact = conversation.contact
          const term = search.toLowerCase()
          return (
            contact?.name?.toLowerCase().includes(term) ||
            contact?.phone?.includes(term) ||
            contact?.wa_id?.includes(term)
          )
        })
      : conversations

    const ids = filtered.map((conversation) => conversation.id)
    let lastMessages: Message[] = []

    if (ids.length > 0) {
      const { data: messages } = await supabase
        .from('messages')
        .select('*')
        .eq('clerk_org_id', tenant.orgId)
        .in('conversation_id', ids)
        .order('created_at', { ascending: false })

      const seen = new Set<string>()
      lastMessages = ((messages || []) as Message[]).filter((message) => {
        if (seen.has(message.conversation_id)) {
          return false
        }

        seen.add(message.conversation_id)
        return true
      })
    }

    const response = filtered.map((conversation) => ({
      ...conversation,
      last_message: lastMessages.find((message) => message.conversation_id === conversation.id) || null
    }))

    return { data: response }
  } catch (error) {
    throw normalizeError(error)
  }
})
