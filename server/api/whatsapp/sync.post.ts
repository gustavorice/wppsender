import { z } from 'zod'
import { getServerSupabase } from '~~/server/utils/supabase'
import { requireOrgAdmin } from '~~/server/utils/auth'
import { fetchContacts, fetchChats } from '~~/server/utils/evolution'
import { normalizeError } from '~~/server/utils/errors'
import { rateLimit } from '~~/server/utils/rateLimit'

const schema = z.object({
  whatsapp_account_id: z.string().uuid()
})

export default defineEventHandler(async (event) => {
  try {
    await rateLimit(event, 'whatsapp:sync', 4, 60)

    const tenant = requireOrgAdmin(event)
    const body = schema.parse(await readBody(event))
    const supabase = getServerSupabase()

    const { data: account, error: accountError } = await supabase
      .from('whatsapp_accounts')
      .select('*')
      .eq('id', body.whatsapp_account_id)
      .eq('clerk_org_id', tenant.orgId)
      .single()

    if (accountError || !account) {
      throw createError({ statusCode: 404, statusMessage: 'Conta WhatsApp nao encontrada nessa organizacao.' })
    }

    if (account.status !== 'connected') {
      throw createError({ statusCode: 409, statusMessage: 'Conecte o numero antes de sincronizar contatos.' })
    }

    const [evolutionContacts, evolutionChats] = await Promise.all([
      fetchContacts(account.instance_name).catch(() => []),
      fetchChats(account.instance_name).catch(() => [])
    ])

    // 1. Upsert contacts
    const contactSeen = new Set<string>()
    const contactRows = evolutionContacts
      .filter((contact) => {
        if (contactSeen.has(contact.waId)) return false
        contactSeen.add(contact.waId)
        return true
      })
      .map((contact) => ({
        clerk_org_id: account.clerk_org_id,
        whatsapp_account_id: account.id,
        wa_id: contact.waId,
        phone: contact.phone,
        name: contact.name || contact.pushName,
        avatar_url: contact.avatarUrl,
        updated_at: new Date().toISOString()
      }))

    let savedContacts = 0
    const chunkSize = 500
    for (let i = 0; i < contactRows.length; i += chunkSize) {
      const chunk = contactRows.slice(i, i + chunkSize)
      const { error: upsertError } = await supabase
        .from('contacts')
        .upsert(chunk, { onConflict: 'clerk_org_id,whatsapp_account_id,wa_id' })
      if (upsertError) throw upsertError
      savedContacts += chunk.length
    }

    // 2. Upsert conversations from chats (so the inbox lights up with chats
    // that have history but no recent activity yet)
    let savedConversations = 0
    if (evolutionChats.length > 0) {
      // Need contact ids: re-select after upsert
      const waIds = Array.from(new Set(evolutionChats.map((c) => c.waId)))
      // Ensure contact row exists for each chat too (chats may include people
      // not in findContacts result)
      const chatContactRows = evolutionChats
        .filter((chat) => !contactSeen.has(chat.waId))
        .map((chat) => ({
          clerk_org_id: account.clerk_org_id,
          whatsapp_account_id: account.id,
          wa_id: chat.waId,
          phone: chat.phone,
          name: chat.name,
          updated_at: new Date().toISOString()
        }))
      if (chatContactRows.length > 0) {
        await supabase
          .from('contacts')
          .upsert(chatContactRows, { onConflict: 'clerk_org_id,whatsapp_account_id,wa_id' })
      }

      const { data: contactsForChats } = await supabase
        .from('contacts')
        .select('id, wa_id')
        .eq('clerk_org_id', account.clerk_org_id)
        .eq('whatsapp_account_id', account.id)
        .in('wa_id', waIds)

      const byWaId = new Map<string, string>()
      for (const row of contactsForChats || []) {
        byWaId.set(row.wa_id as string, row.id as string)
      }

      const convRows = evolutionChats.flatMap((chat) => {
        const cid = byWaId.get(chat.waId)
        if (!cid) return []
        return [
          {
            clerk_org_id: account.clerk_org_id,
            whatsapp_account_id: account.id,
            contact_id: cid,
            status: 'open' as const,
            last_message_at: chat.lastMessageAt,
            updated_at: new Date().toISOString()
          }
        ]
      })

      if (convRows.length > 0) {
        const { error: convError } = await supabase
          .from('conversations')
          .upsert(convRows, { onConflict: 'clerk_org_id,whatsapp_account_id,contact_id' })
        if (convError) throw convError
        savedConversations = convRows.length
      }
    }

    return {
      data: {
        synced: savedContacts,
        chats: savedConversations,
        account_id: account.id
      }
    }
  } catch (error) {
    throw normalizeError(error)
  }
})
