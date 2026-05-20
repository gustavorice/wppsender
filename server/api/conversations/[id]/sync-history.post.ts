import { getRouterParam } from 'h3'
import { getServerSupabase } from '~~/server/utils/supabase'
import { requireTenantAuth } from '~~/server/utils/auth'
import { fetchMessagesFromHistory } from '~~/server/utils/evolution'
import { apiError, normalizeError } from '~~/server/utils/errors'
import { rateLimit } from '~~/server/utils/rateLimit'

export default defineEventHandler(async (event) => {
  try {
    await rateLimit(event, 'conversations:sync-history', 12, 60)

    const tenant = requireTenantAuth(event)
    const conversationId = getRouterParam(event, 'id')
    if (!conversationId) throw apiError(400, 'Conversation ID nao informado.')

    const supabase = getServerSupabase()

    const { data: convData, error: convErr } = await supabase
      .from('conversations')
      .select('*, contact:contacts(*), whatsapp_account:whatsapp_accounts(*)')
      .eq('id', conversationId)
      .eq('clerk_org_id', tenant.orgId)
      .single()

    if (convErr || !convData) {
      throw apiError(404, 'Conversa nao encontrada.')
    }

    const conversation = convData as any
    const account = conversation.whatsapp_account
    const contact = conversation.contact

    if (!account || !contact) {
      throw apiError(409, 'Conversa sem conta ou contato vinculado.')
    }

    if (account.status !== 'connected') {
      // Allow returning silently — UI just won't get extra history
      return { data: { synced: 0, reason: 'account_not_connected' } }
    }

    const remoteJid = `${contact.wa_id}@s.whatsapp.net`
    const history = await fetchMessagesFromHistory(account.instance_name, remoteJid, 150)

    if (history.length === 0) {
      return { data: { synced: 0, reason: 'no_history' } }
    }

    const rows = history.map((m) => ({
      clerk_org_id: tenant.orgId,
      whatsapp_account_id: account.id as string,
      conversation_id: conversation.id as string,
      contact_id: contact.id as string,
      wa_message_id: m.waMessageId,
      direction: m.fromMe ? ('outbound' as const) : ('inbound' as const),
      type: m.type,
      body: m.body,
      media_url: m.mediaUrl,
      raw_payload: m.raw as Record<string, unknown>,
      sent_at: m.sentAt
    }))

    const { error: insertErr } = await supabase
      .from('messages')
      .upsert(rows, {
        onConflict: 'clerk_org_id,whatsapp_account_id,wa_message_id',
        ignoreDuplicates: true
      })

    if (insertErr) {
      throw insertErr
    }

    // Update last_message_at to the most recent
    const last = history[history.length - 1]
    const lastSentAt = last ? last.sentAt : new Date().toISOString()
    await supabase
      .from('conversations')
      .update({ last_message_at: lastSentAt })
      .eq('id', conversation.id as string)
      .eq('clerk_org_id', tenant.orgId)

    return { data: { synced: history.length, last_message_at: lastSentAt } }
  } catch (error) {
    throw normalizeError(error)
  }
})
