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

    // Load the user's own phone numbers (digits-only) so we can filter the
    // owner out of the inbox. WhatsApp gives every account a self-chat that
    // would otherwise show up as a duplicate conversation. We collect the
    // phone_number from every whatsapp_account row in this org because a
    // tenant may have several connected numbers.
    let accountQuery = supabase
      .from('whatsapp_accounts')
      .select('phone_number')
      .eq('clerk_org_id', tenant.orgId)
    if (whatsappAccountId) {
      accountQuery = accountQuery.eq('id', whatsappAccountId)
    }
    const { data: accountRows } = await accountQuery
    const ownerPhones = new Set<string>()
    for (const row of accountRows || []) {
      const raw = String((row as any).phone_number || '').replace(/\D/g, '')
      if (raw) ownerPhones.add(raw)
    }
    const isOwnerContact = (c: { wa_id?: string | null; name?: string | null } | null | undefined): boolean => {
      if (!c) return false
      const digits = String(c.wa_id || '').replace(/\D/g, '')
      if (digits && ownerPhones.has(digits)) return true
      const name = String(c.name || '').trim()
      if (name.startsWith('Você') || name.toLowerCase().startsWith('voce')) return true
      return false
    }

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

    const allConversations = ((data || []) as unknown as Conversation[]).filter((c) => !isOwnerContact(c.contact))

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

    // === DEFENSIVE CLIENT-FACING DEDUP ===
    // Even with all the LID→BR resolution at write time, race conditions
    // and historical duplicates can leave the inbox showing two rows for
    // the same person (one with agenda name, one with WhatsApp pushName).
    // Group by a normalized name key (first 3+ chars of the most reliable
    // name we have), then keep the "best" representative: prefer rows whose
    // wa_id is a real phone, then more messages, then has avatar.
    const normalizeKey = (s: string | null | undefined): string => {
      if (!s) return ''
      // strip accents, lowercase, alpha-only, drop short words
      const stripped = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      const cleaned = stripped.replace(/[^a-z0-9]+/g, ' ').trim()
      const first = cleaned.split(' ').find((w) => w.length >= 3)
      return first || ''
    }
    const isRealPhoneInline = (waId?: string | null): boolean => {
      if (!waId) return false
      if (waId.startsWith('55') && (waId.length === 12 || waId.length === 13)) return true
      if (waId.startsWith('1') && waId.length === 11) return true
      return false
    }
    const scoreConv = (c: Conversation): number => {
      let s = 0
      if (isRealPhoneInline(c.contact?.wa_id)) s += 10000
      if (c.contact?.avatar_url) s += 100
      if (c.contact?.name) s += 50
      // boost by message count (already hydrated last_message proves >=1)
      if (c.last_message) s += 1
      return s
    }
    const groups = new Map<string, Conversation[]>()
    const ungrouped: Conversation[] = []
    for (const conv of hydrated) {
      const key = normalizeKey(conv.contact?.name || conv.contact?.push_name)
      if (!key) {
        ungrouped.push(conv)
        continue
      }
      const arr = groups.get(key) || []
      arr.push(conv)
      groups.set(key, arr)
    }
    const deduped: Conversation[] = [...ungrouped]
    for (const [, arr] of groups) {
      arr.sort((a, b) => scoreConv(b) - scoreConv(a))
      const winner = arr[0]
      if (!winner) continue
      // If the winner has no last_message but a sibling does, borrow it so
      // the inbox preview shows real activity instead of "Nova conversa".
      if (!winner.last_message) {
        for (const sib of arr) {
          if (sib.last_message) {
            winner.last_message = sib.last_message
            const sibTs = sib.last_message_at ? new Date(sib.last_message_at).getTime() : 0
            const winTs = winner.last_message_at ? new Date(winner.last_message_at).getTime() : 0
            if (sibTs > winTs) winner.last_message_at = sib.last_message_at
            break
          }
        }
      }
      deduped.push(winner)
    }
    // Re-sort the final list by last_message_at desc.
    deduped.sort((a, b) => {
      const aT = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
      const bT = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
      return bT - aT
    })

    // 3. Contacts WITHOUT a conversation yet (so the inbox lists everyone
    // from the address book, not just people who already messaged you).
    // Also exclude any contact whose name key matches a conversation we're
    // already showing — they were dedup'd above and shouldn't reappear as
    // orphans.
    const contactsWithConv = new Set(allConversations.map((c) => c.contact_id))
    const groupedNameKeys = new Set<string>()
    for (const c of deduped) {
      const key = normalizeKey(c.contact?.name || c.contact?.push_name)
      if (key) groupedNameKeys.add(key)
    }

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

    const orphanContacts = (contactRows || []).filter((c: any) => {
      if (isOwnerContact(c)) return false
      if (contactsWithConv.has(c.id)) return false
      const key = normalizeKey(c.name || c.push_name)
      if (key && groupedNameKeys.has(key)) return false
      return matchesSearch(c)
    }) as Array<Contact & {
      whatsapp_account?: Pick<WhatsAppAccount, 'id' | 'display_name' | 'phone_number' | 'status'> | null
    }>

    // Return both lists. Frontend renders conversations first, then a
    // "Outros contatos" section for the rest.
    return {
      data: deduped,
      contacts_without_conversation: orphanContacts
    }
  } catch (error) {
    throw normalizeError(error)
  }
})
