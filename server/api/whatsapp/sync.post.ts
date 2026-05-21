import { z } from 'zod'
import { getServerSupabase } from '~~/server/utils/supabase'
import { requireOrgAdmin } from '~~/server/utils/auth'
import { fetchContacts, fetchChats } from '~~/server/utils/evolution'
import { normalizeError } from '~~/server/utils/errors'
import { rateLimit } from '~~/server/utils/rateLimit'
import { isRealPhone } from '~~/server/utils/jid'

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
    // BR/real vs LID and pair them when pushName OR avatar matches. The
    // resulting contact rows always use the real BR phone as wa_id; the LID
    // is stored on contacts.lid_alt so the webhook can map future @lid
    // messages back to the real contact without creating duplicates.
    const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')

    // Avatar URLs from WhatsApp's CDN look like
    // `.../t/v/<crypted>/<id>_<id>_<n>.jpg?...`. Two contacts sharing the
    // SAME filename portion are almost certainly the same person — WhatsApp
    // gives every profile a stable image id. We strip the query string and
    // the path prefix, then use the basename as the join key.
    const avatarKey = (url: string | null | undefined): string | null => {
      if (!url) return null
      const noQuery = url.split('?')[0] || ''
      const lastSlash = noQuery.lastIndexOf('/')
      const file = lastSlash >= 0 ? noQuery.slice(lastSlash + 1) : noQuery
      if (!file || file.length < 6) return null
      return file.toLowerCase()
    }

    const realByName = new Map<string, typeof evolutionContacts[number]>()
    const realByAvatar = new Map<string, typeof evolutionContacts[number]>()
    const lidsByName: Array<typeof evolutionContacts[number]> = []
    for (const c of evolutionContacts) {
      if (isRealPhone(c.waId)) {
        const key = norm(c.name || c.pushName)
        if (key && !realByName.has(key)) realByName.set(key, c)
        const avatar = avatarKey(c.avatarUrl)
        if (avatar && !realByAvatar.has(avatar)) realByAvatar.set(avatar, c)
      } else {
        lidsByName.push(c)
      }
    }

    const lidAltByRealWaId = new Map<string, string>()
    const consumedLidWaIds = new Set<string>()
    for (const lid of lidsByName) {
      let match: typeof evolutionContacts[number] | undefined

      // Avatar match first — strongest signal (file ids are globally unique).
      const lidAvatar = avatarKey(lid.avatarUrl)
      if (lidAvatar) {
        match = realByAvatar.get(lidAvatar)
      }

      // Fall back to name-based matching when avatar didn't resolve.
      const lidName = match ? '' : norm(lid.name || lid.pushName)
      if (!match && lidName) {
        // exact then prefix in both directions
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
