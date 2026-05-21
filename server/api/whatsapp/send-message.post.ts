import { z } from 'zod'
import { getServerSupabase } from '~~/server/utils/supabase'
import { requireTenantAuth } from '~~/server/utils/auth'
import { sendTextMessage } from '~~/server/utils/evolution'
import { apiError, normalizeError } from '~~/server/utils/errors'
import { rateLimit } from '~~/server/utils/rateLimit'
import type { Contact } from '~~/types/entities'

const schema = z.object({
  whatsapp_account_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  text: z.string().trim().min(1).max(4000)
})

export default defineEventHandler(async (event) => {
  try {
    await rateLimit(event, 'whatsapp:send-message', 60, 60)

    const tenant = requireTenantAuth(event)
    const body = schema.parse(await readBody(event))
    const supabase = getServerSupabase()

    const { data: account, error: accountError } = await supabase
      .from('whatsapp_accounts')
      .select('*')
      .eq('id', body.whatsapp_account_id)
      .eq('clerk_org_id', tenant.orgId)
      .single()

    if (accountError || !account) {
      throw apiError(404, 'Numero de WhatsApp nao encontrado neste time.')
    }

    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', body.conversation_id)
      .eq('clerk_org_id', tenant.orgId)
      .eq('whatsapp_account_id', account.id)
      .single()

    if (conversationError || !conversation) {
      throw apiError(404, 'Conversa nao encontrada neste time.')
    }

    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', conversation.contact_id)
      .eq('clerk_org_id', tenant.orgId)
      .eq('whatsapp_account_id', account.id)
      .single()

    if (contactError || !contact) {
      throw apiError(404, 'Contato nao encontrado neste time.')
    }

    if (account.status !== 'connected') {
      throw apiError(409, 'Este numero ainda nao esta conectado.')
    }

    const typedContact = contact as Contact
    const phone = typedContact.phone || typedContact.wa_id
    const delivery = await sendTextMessage(account.instance_name, phone, body.text)
    const sentAt = new Date().toISOString()

    const { data: message, error: messageError } = await supabase
      .from('messages')
      .insert({
        clerk_org_id: tenant.orgId,
        whatsapp_account_id: account.id,
        conversation_id: conversation.id,
        contact_id: typedContact.id,
        wa_message_id: delivery.waMessageId || `out_${crypto.randomUUID()}`,
        direction: 'outbound',
        type: 'text',
        status: 'sent',
        body: body.text,
        raw_payload: delivery.raw as Record<string, unknown>,
        sent_at: sentAt
      })
      .select('*')
      .single()

    if (messageError || !message) {
      throw messageError
    }

    await supabase
      .from('conversations')
      .update({ last_message_at: sentAt })
      .eq('id', conversation.id)
      .eq('clerk_org_id', tenant.orgId)

    return { data: message }
  } catch (error) {
    throw normalizeError(error)
  }
})
