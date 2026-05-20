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

    // Cross-reference: for each contact returned by Evolution, classify
    // BR/real vs LID and pair them when pushName matches. The resulting
    // contact rows always use the real BR phone as wa_id; the LID is stored
    // on contacts.lid_alt so the webhook can map future @lid messages back
    // to the real contact without creating duplicates.
    const isRealPhone = (waId: string): boolean => {
      if (!waId) return false
      if (waId.startsWith('55') && (waId.length === 12 || waId.length === 13)) return true
      if (waId.startsWith('1') && waId.length === 11) return true
      if (waId.length >= 10 && waId.length <= 13) {
        const cc2 = waId.slice(0, 2)
        const cc3 = waId.slice(0, 3)
        const known = new Set(['44', '49', '33', '34', '39', '31', '52', '54', '57', '58', '56', '51', '53', '61', '64', '82', '81', '86', '351', '353', '358'])
        return known.has(cc2) || known.has(cc3)
      }
      return false
    }
    const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')

    const realByName = new Map<string, typeof evolutionContacts[number]>()
    const lidsByName: Array<typeof evolutionContacts[number]> = []
    for (const c of evolutionContacts) {
      if (isRealPhone(c.waId)) {
        const key = norm(c.name || c.pushName)
        if (key && !realByName.has(key)) realByName.set(key, c)
      } else {
        lidsByName.push(c)
      }
    }

    const lidAltByRealWaId = new Map<string, string>()
    const consumedLidWaIds = new Set<string>()
    for (const lid of lidsByName) {
      const lidName = norm(lid.name || lid.pushName)
      if (!lidName) continue
      // exact then prefix in both directions
      let match: typeof evolutionContacts[number] | undefined
      if (realByName.has(lidName)) {
        match = realByName.get(lidName)
      } else {
        for (const [k, real] of realByName.entries()) {
          if (k.length < 4 || lidName.length < 4) continue
          if (k.startsWith(lidName) || lidName.startsWith(k) || k.includes(lidName) || lidName.includes(k)) {
            const ratio = Math.min(k.length, lidName.length) / Math.max(k.length, lidName.length)
            if (ratio >= 0.3) {
              match = real
              break
            }
          }
        }
      }
      if (match) {
        lidAltByRealWaId.set(match.waId, lid.waId)
        consumedLidWaIds.add(lid.waId)
      }
    }

    // 1. Upsert ONLY real contacts (we never persist LID-only rows in the
    // contacts table — they live inside the BR row as lid_alt).
    const contactSeen = new Set<string>()
    const contactRows = evolutionContacts
      .filter((contact) => {
        if (!isRealPhone(contact.waId)) return false
        if (contactSeen.has(contact.waId)) return false
        contactSeen.add(contact.waId)
        return true
      })
      .map((contact) => ({
        clerk_org_id: account.clerk_org_id,
        whatsapp_account_id: account.id,
        wa_id: contact.waId,
        phone: contact.phone || contact.waId,
        name: contact.name || contact.pushName,
        push_name: contact.pushName,
        avatar_url: contact.avatarUrl,
        ...(lidAltByRealWaId.get(contact.waId) ? { lid_alt: lidAltByRealWaId.get(contact.waId) } : {}),
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

    // 2. Upsert conversations from chats. We only create chat rows for
    // contacts that exist as real (BR) phones — LID-only chats fall through
    // to the webhook's lid_alt lookup when actual messages arrive.
    let savedConversations = 0
    if (evolutionChats.length > 0) {
      const realChats = evolutionChats.filter((chat) => isRealPhone(chat.waId))
      const waIds = Array.from(new Set(realChats.map((c) => c.waId)))
      const chatContactRows = realChats
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

      const convRows = realChats.flatMap((chat) => {
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
