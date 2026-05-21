import { z } from 'zod'
import { getServerSupabase } from '~~/server/utils/supabase'
import { requireOrgAdmin } from '~~/server/utils/auth'
import { apiError, normalizeError } from '~~/server/utils/errors'
import { rateLimit } from '~~/server/utils/rateLimit'
import { isRealPhone } from '~~/server/utils/jid'

const schema = z.object({
  whatsapp_account_id: z.string().uuid()
})

// One-shot DB cleanup for an account. Three operations, all idempotent:
//   a) Backfill conversations.last_message_at from messages.sent_at when the
//      stored value is NULL or older than the true max. Fixes BR conversations
//      that ended up NULL because the webhook used to upsert with the
//      MESSAGES_SET history's stale timestamps.
//   b) Merge unresolved LID contacts into BR contacts when they share an
//      avatar_url. The avatar URL's basename is a WhatsApp-stable image id, so
//      two contacts with the same URL are the same person. Moves messages,
//      deletes the LID conversation and contact, and writes lid_alt onto the
//      BR row so future webhooks skip the lookup.
//   c) Returns counts of each operation for the UI.
//
// Why no raw SQL: Supabase JS client doesn't expose .raw(). The backfill
// fetches conversation_id → max(sent_at) groupings via aggregation in JS, then
// issues per-row updates with a strictly-newer guard.
export default defineEventHandler(async (event) => {
  try {
    await rateLimit(event, 'whatsapp:reconcile', 3, 60)

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
      throw apiError(404, 'Conta WhatsApp nao encontrada nessa organizacao.')
    }

    // ===== a) Backfill last_message_at =====
    // Pull all conversations for this account, then per-conversation pick the
    // newest message.sent_at and update when it's strictly newer than the
    // current value (or NULL). We chunk the message fetch by conversation_id
    // to avoid loading every message of the org into memory.
    const { data: convRows, error: convErr } = await supabase
      .from('conversations')
      .select('id, last_message_at')
      .eq('clerk_org_id', tenant.orgId)
      .eq('whatsapp_account_id', account.id)
    if (convErr) throw convErr

    const conversations = (convRows || []) as Array<{ id: string; last_message_at: string | null }>
    let backfilled = 0

    // Fetch latest sent_at per conversation in chunks. With a few hundred
    // conversations per account this is one round-trip per chunk.
    const convIds = conversations.map((c) => c.id)
    const maxSentByConv = new Map<string, string>()
    const chunkSize = 100
    for (let i = 0; i < convIds.length; i += chunkSize) {
      const chunk = convIds.slice(i, i + chunkSize)
      const { data: msgs, error: msgErr } = await supabase
        .from('messages')
        .select('conversation_id, sent_at')
        .eq('clerk_org_id', tenant.orgId)
        .in('conversation_id', chunk)
        .not('sent_at', 'is', null)
        .order('sent_at', { ascending: false })
      if (msgErr) throw msgErr
      for (const m of (msgs || []) as Array<{ conversation_id: string; sent_at: string | null }>) {
        if (!m.sent_at) continue
        if (!maxSentByConv.has(m.conversation_id)) {
          maxSentByConv.set(m.conversation_id, m.sent_at)
        }
      }
    }

    for (const conv of conversations) {
      const maxSent = maxSentByConv.get(conv.id)
      if (!maxSent) continue
      const currentTs = conv.last_message_at ? new Date(conv.last_message_at).getTime() : 0
      const newTs = new Date(maxSent).getTime()
      if (Number.isNaN(newTs) || newTs <= currentTs) continue
      const { error: updErr } = await supabase
        .from('conversations')
        .update({ last_message_at: maxSent })
        .eq('id', conv.id)
        .eq('clerk_org_id', tenant.orgId)
        .or(`last_message_at.is.null,last_message_at.lt.${maxSent}`)
      if (!updErr) backfilled += 1
    }

    // ===== b) Merge LIDs into BR by avatar URL =====
    // Find LID contacts (wa_id is not a real phone) with name IS NULL and a
    // non-null avatar_url. For each, look for any BR contact in the same
    // account with the same avatar_url. If found:
    //   1. Move messages from LID conversation → BR conversation.
    //   2. Delete the LID conversation (now empty).
    //   3. Delete the LID contact.
    //   4. Set lid_alt on the BR contact so future webhooks resolve in O(1).
    const { data: allContacts, error: contactsErr } = await supabase
      .from('contacts')
      .select('id, wa_id, phone, name, avatar_url, lid_alt')
      .eq('clerk_org_id', tenant.orgId)
      .eq('whatsapp_account_id', account.id)
    if (contactsErr) throw contactsErr

    const contacts = (allContacts || []) as Array<{
      id: string
      wa_id: string
      phone: string | null
      name: string | null
      avatar_url: string | null
      lid_alt: string | null
    }>

    // Build avatar → BR contact index.
    const brByAvatar = new Map<string, typeof contacts[number]>()
    for (const c of contacts) {
      if (!isRealPhone(c.wa_id)) continue
      if (!c.avatar_url) continue
      if (!brByAvatar.has(c.avatar_url)) brByAvatar.set(c.avatar_url, c)
    }

    // Find LID candidates.
    const lidCandidates = contacts.filter((c) => {
      if (isRealPhone(c.wa_id)) return false
      if (c.name) return false
      if (!c.avatar_url) return false
      return brByAvatar.has(c.avatar_url)
    })

    let merged = 0
    let deleted = 0

    for (const lid of lidCandidates) {
      const br = brByAvatar.get(lid.avatar_url || '')
      if (!br) continue
      if (br.id === lid.id) continue

      // Get BOTH conversations (LID + BR). The BR may not have one yet — we
      // need to ensure there's a target conversation before moving messages.
      const { data: lidConv } = await supabase
        .from('conversations')
        .select('id')
        .eq('clerk_org_id', tenant.orgId)
        .eq('whatsapp_account_id', account.id)
        .eq('contact_id', lid.id)
        .maybeSingle()

      let { data: brConv } = await supabase
        .from('conversations')
        .select('id')
        .eq('clerk_org_id', tenant.orgId)
        .eq('whatsapp_account_id', account.id)
        .eq('contact_id', br.id)
        .maybeSingle()

      if (!brConv) {
        const { data: created } = await supabase
          .from('conversations')
          .insert({
            clerk_org_id: tenant.orgId,
            whatsapp_account_id: account.id,
            contact_id: br.id,
            status: 'open'
          })
          .select('id')
          .single()
        brConv = created ?? null
      }

      if (!brConv) continue

      // Move messages from LID conversation → BR conversation (and rewrite
      // their contact_id to the BR contact so RLS / joins stay consistent).
      if (lidConv) {
        await supabase
          .from('messages')
          .update({ conversation_id: brConv.id, contact_id: br.id })
          .eq('clerk_org_id', tenant.orgId)
          .eq('conversation_id', lidConv.id)
      }

      // Also move any messages that point to lid.id directly without a
      // conversation row (defensive — should be rare).
      await supabase
        .from('messages')
        .update({ conversation_id: brConv.id, contact_id: br.id })
        .eq('clerk_org_id', tenant.orgId)
        .eq('contact_id', lid.id)

      // Delete the now-empty LID conversation.
      if (lidConv) {
        await supabase
          .from('conversations')
          .delete()
          .eq('id', lidConv.id)
          .eq('clerk_org_id', tenant.orgId)
      }

      // Set lid_alt on the BR contact (preserve existing value if already
      // set to a different LID — pick the first non-null).
      if (!br.lid_alt) {
        await supabase
          .from('contacts')
          .update({ lid_alt: lid.wa_id })
          .eq('id', br.id)
          .eq('clerk_org_id', tenant.orgId)
        br.lid_alt = lid.wa_id
      }

      // Delete the LID contact.
      await supabase
        .from('contacts')
        .delete()
        .eq('id', lid.id)
        .eq('clerk_org_id', tenant.orgId)

      merged += 1
      deleted += 1
    }

    return {
      data: {
        backfilled,
        merged,
        deleted
      }
    }
  } catch (error) {
    throw normalizeError(error)
  }
})
