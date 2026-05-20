import { z } from 'zod'
import { getServerSupabase } from '~~/server/utils/supabase'
import { requireOrgAdmin } from '~~/server/utils/auth'
import { fetchAllMessages } from '~~/server/utils/evolution'
import { apiError, normalizeError } from '~~/server/utils/errors'
import { rateLimit } from '~~/server/utils/rateLimit'

const schema = z.object({
  whatsapp_account_id: z.string().uuid()
})

export default defineEventHandler(async (event) => {
  try {
    await rateLimit(event, 'whatsapp:sync-history', 2, 60)

    const tenant = requireOrgAdmin(event)
    const body = schema.parse(await readBody(event))
    const supabase = getServerSupabase()

    const { data: accountRow, error: accErr } = await supabase
      .from('whatsapp_accounts')
      .select('*')
      .eq('id', body.whatsapp_account_id)
      .eq('clerk_org_id', tenant.orgId)
      .single()

    if (accErr || !accountRow) {
      throw apiError(404, 'Conta WhatsApp nao encontrada.')
    }

    const account = accountRow as any
    if (account.status !== 'connected') {
      throw apiError(409, 'Conecte o numero antes de sincronizar o historico.')
    }

    const messages = await fetchAllMessages(account.instance_name, 30)

    if (messages.length === 0) {
      return { data: { synced: 0, conversations: 0, contacts: 0 } }
    }

    // 1. Bucket by phone (one contact + one conversation per unique phone)
    const byPhone = new Map<string, typeof messages>()
    for (const m of messages) {
      const arr = byPhone.get(m.phone) || []
      arr.push(m)
      byPhone.set(m.phone, arr)
    }

    // 2. Upsert contacts
    const contactRows = Array.from(byPhone.entries()).map(([phone, msgs]) => {
      // Find a non-fromMe pushName (the contact's name); falls back to null.
      const inboundPush = msgs.find((m) => !m.fromMe)?.pushName || null
      return {
        clerk_org_id: tenant.orgId,
        whatsapp_account_id: account.id,
        wa_id: phone,
        phone,
        name: inboundPush,
        updated_at: new Date().toISOString()
      }
    })

    const { error: contactErr } = await supabase
      .from('contacts')
      .upsert(contactRows, { onConflict: 'clerk_org_id,whatsapp_account_id,wa_id', ignoreDuplicates: false })

    if (contactErr) throw contactErr

    // 3. Re-select to grab ids
    const phones = contactRows.map((c) => c.wa_id)
    const { data: contactRecs } = await supabase
      .from('contacts')
      .select('id, wa_id')
      .eq('clerk_org_id', tenant.orgId)
      .eq('whatsapp_account_id', account.id)
      .in('wa_id', phones)

    const contactByPhone = new Map<string, string>()
    for (const c of contactRecs || []) contactByPhone.set(c.wa_id as string, c.id as string)

    // 4. Upsert conversations
    const conversationRows = Array.from(byPhone.entries()).flatMap(([phone, msgs]) => {
      const contactId = contactByPhone.get(phone)
      if (!contactId) return []
      const lastTs = msgs[msgs.length - 1].sentAt
      return [
        {
          clerk_org_id: tenant.orgId,
          whatsapp_account_id: account.id as string,
          contact_id: contactId,
          status: 'open' as const,
          last_message_at: lastTs,
          updated_at: new Date().toISOString()
        }
      ]
    })

    if (conversationRows.length > 0) {
      const { error: convErr } = await supabase
        .from('conversations')
        .upsert(conversationRows, { onConflict: 'clerk_org_id,whatsapp_account_id,contact_id' })
      if (convErr) throw convErr
    }

    // 5. Re-select conversations
    const { data: convRecs } = await supabase
      .from('conversations')
      .select('id, contact_id')
      .eq('clerk_org_id', tenant.orgId)
      .eq('whatsapp_account_id', account.id)
      .in('contact_id', Array.from(contactByPhone.values()))

    const convByContact = new Map<string, string>()
    for (const c of convRecs || []) convByContact.set(c.contact_id as string, c.id as string)

    // 6. Upsert messages in chunks
    const messageRows = messages.flatMap((m) => {
      const contactId = contactByPhone.get(m.phone)
      if (!contactId) return []
      const conversationId = convByContact.get(contactId)
      if (!conversationId) return []
      return [
        {
          clerk_org_id: tenant.orgId,
          whatsapp_account_id: account.id as string,
          conversation_id: conversationId,
          contact_id: contactId,
          wa_message_id: m.waMessageId,
          direction: m.fromMe ? ('outbound' as const) : ('inbound' as const),
          type: m.type,
          body: m.body,
          media_url: m.mediaUrl,
          raw_payload: m.raw as Record<string, unknown>,
          sent_at: m.sentAt
        }
      ]
    })

    const chunkSize = 500
    let savedMessages = 0
    for (let i = 0; i < messageRows.length; i += chunkSize) {
      const chunk = messageRows.slice(i, i + chunkSize)
      const { error: msgErr } = await supabase
        .from('messages')
        .upsert(chunk, { onConflict: 'clerk_org_id,whatsapp_account_id,wa_message_id', ignoreDuplicates: true })
      if (msgErr) throw msgErr
      savedMessages += chunk.length
    }

    return {
      data: {
        synced: savedMessages,
        conversations: conversationRows.length,
        contacts: contactRows.length
      }
    }
  } catch (error) {
    throw normalizeError(error)
  }
})
