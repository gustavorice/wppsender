import { z } from 'zod'
import { getServerSupabase } from '~~/server/utils/supabase'
import { requireOrgAdmin } from '~~/server/utils/auth'
import { fetchAllMessages, fetchContactProfile } from '~~/server/utils/evolution'
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

    // Throttle: don't re-run history sync more than once every 5 minutes.
    // Stops the visible flicker that happens when the auto-sync fires
    // on every /settings/whatsapp visit and shuffles the contact list.
    const force = Boolean((event.context.query as any)?.force)
    const lastSyncIso = account.last_history_synced_at as string | null
    if (!force && lastSyncIso) {
      const ageMs = Date.now() - new Date(lastSyncIso).getTime()
      if (ageMs >= 0 && ageMs < 5 * 60 * 1000) {
        return { data: { synced: 0, reason: 'throttled', last_synced_at: lastSyncIso } }
      }
    }

    const messages = await fetchAllMessages(account.instance_name, 30)

    if (messages.length === 0) {
      return { data: { synced: 0, conversations: 0, contacts: 0 } }
    }

    // 1. Bucket by phone (one contact + one conversation per unique phone)
    const byPhone = new Map<string, typeof messages>()
    const isLidByPhone = new Map<string, boolean>()
    for (const m of messages) {
      const arr = byPhone.get(m.phone) || []
      arr.push(m)
      byPhone.set(m.phone, arr)
      if (m.remoteJid.includes('@lid')) {
        isLidByPhone.set(m.phone, true)
      }
    }

    // 1b. Enrich each contact (parallel, capped) with name + avatar from
    // the appropriate Evolution lookup. This is what populates "Gabriel
    // Barreto" + foto on a row whose wa_id is a LID number.
    const phonesToEnrich = Array.from(byPhone.keys())
    const enrichResults = new Map<string, { name: string | null; avatarUrl: string | null }>()
    const concurrency = 5
    for (let i = 0; i < phonesToEnrich.length; i += concurrency) {
      const batch = phonesToEnrich.slice(i, i + concurrency)
      await Promise.all(
        batch.map(async (phone) => {
          const isLid = isLidByPhone.get(phone) === true
          const profile = await fetchContactProfile(account.instance_name, phone, { isLid, timeoutMs: 4000 }).catch(() => null)
          if (profile) enrichResults.set(phone, profile)
        })
      )
    }

    // 2. Build contact rows.
    // Rule: For LID phones (not BR-like 12-13 with 55 prefix), only create
    // the contact if we managed to fetch SOMETHING (name OR avatar). That
    // prevents "+213283915231476" rows with zero usable info.
    const isBrazilian = (p: string) => p.startsWith('55') && p.length >= 12 && p.length <= 13
    const contactRows = Array.from(byPhone.entries())
      .flatMap(([phone, msgs]) => {
        const inboundPush = msgs.find((m) => !m.fromMe)?.pushName || null
        const enriched = enrichResults.get(phone)
        const name = enriched?.name || inboundPush
        const avatarUrl = enriched?.avatarUrl || null
        const isLid = isLidByPhone.get(phone) === true
        if (isLid && !isBrazilian(phone) && !name && !avatarUrl) {
          // Pure LID with zero metadata — skip. Avoids creating ghost
          // contacts that show up as raw numbers in the inbox.
          return []
        }
        return [
          {
            clerk_org_id: tenant.orgId,
            whatsapp_account_id: account.id,
            wa_id: phone,
            phone,
            name,
            push_name: inboundPush,
            avatar_url: avatarUrl,
            updated_at: new Date().toISOString()
          }
        ]
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
      const last = msgs[msgs.length - 1]
      const lastTs = last ? last.sentAt : new Date().toISOString()
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

    // 7. MERGE pass — when the same name exists on a "real phone" contact
    // AND on a LID contact, fold the LID contact into the real one so the
    // inbox doesn't show duplicates. (`findContacts` produced the real
    // entries; `findMessages` produced the LID ones.)
    const { data: allContacts } = await supabase
      .from('contacts')
      .select('id, wa_id, name, avatar_url')
      .eq('clerk_org_id', tenant.orgId)
      .eq('whatsapp_account_id', account.id as string)

    const realByName = new Map<string, { id: string; wa_id: string; avatar_url: string | null }>()
    const lidByName = new Map<string, Array<{ id: string; wa_id: string; avatar_url: string | null }>>()
    for (const c of allContacts || []) {
      if (!c.name) continue
      const key = String(c.name).trim().toLowerCase()
      if (!key) continue
      const len = (c.wa_id as string).length
      const isReal = len >= 10 && len <= 13 && (c.wa_id as string).startsWith('55')
      if (isReal) {
        if (!realByName.has(key)) realByName.set(key, { id: c.id as string, wa_id: c.wa_id as string, avatar_url: c.avatar_url as string | null })
      } else {
        const arr = lidByName.get(key) || []
        arr.push({ id: c.id as string, wa_id: c.wa_id as string, avatar_url: c.avatar_url as string | null })
        lidByName.set(key, arr)
      }
    }

    // Also index by avatar_url so identical photos count as the same person.
    const realByAvatar = new Map<string, { id: string; wa_id: string; avatar_url: string | null }>()
    for (const c of allContacts || []) {
      if (!c.avatar_url) continue
      const len = (c.wa_id as string).length
      const isReal = len >= 10 && len <= 13 && (c.wa_id as string).startsWith('55')
      if (isReal && !realByAvatar.has(c.avatar_url as string)) {
        realByAvatar.set(c.avatar_url as string, { id: c.id as string, wa_id: c.wa_id as string, avatar_url: c.avatar_url as string })
      }
    }

    let merged = 0
    // First pass: merge LID -> real by name
    for (const [key, lids] of lidByName.entries()) {
      const real = realByName.get(key)
      if (!real) continue
      for (const lid of lids) {
        // Copy avatar over if real one lacks it
        if (lid.avatar_url && !real.avatar_url) {
          await supabase
            .from('contacts')
            .update({ avatar_url: lid.avatar_url })
            .eq('id', real.id)
            .eq('clerk_org_id', tenant.orgId)
          real.avatar_url = lid.avatar_url
        }
        // Find LID conversation
        const { data: lidConvs } = await supabase
          .from('conversations')
          .select('id, last_message_at')
          .eq('clerk_org_id', tenant.orgId)
          .eq('whatsapp_account_id', account.id as string)
          .eq('contact_id', lid.id)

        const { data: realConv } = await supabase
          .from('conversations')
          .select('id, last_message_at')
          .eq('clerk_org_id', tenant.orgId)
          .eq('whatsapp_account_id', account.id as string)
          .eq('contact_id', real.id)
          .maybeSingle()

        let realConvId: string | null = realConv?.id ?? null
        if (!realConvId) {
          // Create real conv if missing
          const { data: created } = await supabase
            .from('conversations')
            .insert({
              clerk_org_id: tenant.orgId,
              whatsapp_account_id: account.id as string,
              contact_id: real.id,
              status: 'open'
            })
            .select('id')
            .single()
          realConvId = created?.id ?? null
        }

        if (realConvId) {
          // Repoint messages from each LID conversation to the real one
          for (const lc of lidConvs || []) {
            await supabase
              .from('messages')
              .update({ conversation_id: realConvId, contact_id: real.id })
              .eq('clerk_org_id', tenant.orgId)
              .eq('conversation_id', lc.id as string)
          }
        }

        // Delete LID conversations + contact (messages already repointed)
        for (const lc of lidConvs || []) {
          await supabase.from('conversations').delete().eq('id', lc.id as string).eq('clerk_org_id', tenant.orgId)
        }
        await supabase.from('contacts').delete().eq('id', lid.id).eq('clerk_org_id', tenant.orgId)
        merged += 1
      }
    }

    // Second pass: merge any leftover LID -> real by avatar_url match
    const { data: remainingContacts } = await supabase
      .from('contacts')
      .select('id, wa_id, name, avatar_url')
      .eq('clerk_org_id', tenant.orgId)
      .eq('whatsapp_account_id', account.id as string)

    for (const c of remainingContacts || []) {
      const len = (c.wa_id as string).length
      const isReal = len >= 10 && len <= 13 && (c.wa_id as string).startsWith('55')
      if (isReal) continue
      if (!c.avatar_url) continue
      const realMatch = realByAvatar.get(c.avatar_url as string)
      if (!realMatch || realMatch.id === c.id) continue

      // Move conversations and messages from this LID contact to the real one
      const { data: lidConvs } = await supabase
        .from('conversations')
        .select('id')
        .eq('clerk_org_id', tenant.orgId)
        .eq('whatsapp_account_id', account.id as string)
        .eq('contact_id', c.id as string)

      const { data: realConv } = await supabase
        .from('conversations')
        .select('id')
        .eq('clerk_org_id', tenant.orgId)
        .eq('whatsapp_account_id', account.id as string)
        .eq('contact_id', realMatch.id)
        .maybeSingle()

      let realConvId = realConv?.id ?? null
      if (!realConvId && lidConvs && lidConvs.length > 0) {
        const { data: created } = await supabase
          .from('conversations')
          .insert({
            clerk_org_id: tenant.orgId,
            whatsapp_account_id: account.id as string,
            contact_id: realMatch.id,
            status: 'open'
          })
          .select('id')
          .single()
        realConvId = created?.id ?? null
      }

      if (realConvId) {
        for (const lc of lidConvs || []) {
          await supabase
            .from('messages')
            .update({ conversation_id: realConvId, contact_id: realMatch.id })
            .eq('clerk_org_id', tenant.orgId)
            .eq('conversation_id', lc.id as string)
        }
      }
      for (const lc of lidConvs || []) {
        await supabase.from('conversations').delete().eq('id', lc.id as string).eq('clerk_org_id', tenant.orgId)
      }
      await supabase.from('contacts').delete().eq('id', c.id as string).eq('clerk_org_id', tenant.orgId)
      merged += 1
    }

    // Persist throttle marker
    await supabase
      .from('whatsapp_accounts')
      .update({ last_history_synced_at: new Date().toISOString() })
      .eq('id', account.id as string)
      .eq('clerk_org_id', tenant.orgId)

    return {
      data: {
        synced: savedMessages,
        conversations: conversationRows.length,
        contacts: contactRows.length,
        merged
      }
    }
  } catch (error) {
    throw normalizeError(error)
  }
})
