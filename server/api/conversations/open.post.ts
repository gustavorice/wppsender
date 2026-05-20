import { z } from 'zod'
import { getServerSupabase } from '~~/server/utils/supabase'
import { requireTenantAuth } from '~~/server/utils/auth'
import { apiError, normalizeError } from '~~/server/utils/errors'
import { rateLimit } from '~~/server/utils/rateLimit'

const schema = z.object({
  contact_id: z.string().uuid()
})

export default defineEventHandler(async (event) => {
  try {
    await rateLimit(event, 'conversations:open', 60, 60)

    const tenant = requireTenantAuth(event)
    const body = schema.parse(await readBody(event))
    const supabase = getServerSupabase()

    // Load the contact to confirm tenant and grab account
    const { data: contact, error: contactErr } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', body.contact_id)
      .eq('clerk_org_id', tenant.orgId)
      .single()

    if (contactErr || !contact) {
      throw apiError(404, 'Contato nao encontrado nesta organizacao.')
    }

    // Find existing conversation or create a new one
    const { data: existing } = await supabase
      .from('conversations')
      .select('*, contact:contacts(*), whatsapp_account:whatsapp_accounts(id, display_name, phone_number, status)')
      .eq('clerk_org_id', tenant.orgId)
      .eq('whatsapp_account_id', contact.whatsapp_account_id)
      .eq('contact_id', contact.id)
      .maybeSingle()

    if (existing) {
      return { data: existing }
    }

    const { data: created, error: createErr } = await supabase
      .from('conversations')
      .insert({
        clerk_org_id: tenant.orgId,
        whatsapp_account_id: contact.whatsapp_account_id,
        contact_id: contact.id,
        status: 'open'
      })
      .select('*, contact:contacts(*), whatsapp_account:whatsapp_accounts(id, display_name, phone_number, status)')
      .single()

    if (createErr || !created) {
      throw createErr
    }

    return { data: created }
  } catch (error) {
    throw normalizeError(error)
  }
})
