import { z } from 'zod'
import { getRouterParam } from 'h3'
import { getServerSupabase } from '~~/server/utils/supabase'
import { requireTenantAuth } from '~~/server/utils/auth'
import { apiError, normalizeError } from '~~/server/utils/errors'

// Lets the user override a contact's display name. Used primarily for LID
// contacts that Evolution doesn't have a pushName for — the user types in
// "Trevo Gelado" or "CONT-JUS" once and we save it as the name so the inbox
// stops showing "Contato".
const schema = z.object({
  name: z.string().trim().min(1).max(120)
})

export default defineEventHandler(async (event) => {
  try {
    const tenant = requireTenantAuth(event)
    const contactId = getRouterParam(event, 'id')
    if (!contactId) throw apiError(400, 'Contato nao informado.')

    const body = schema.parse(await readBody(event))
    const supabase = getServerSupabase()

    const { data, error } = await supabase
      .from('contacts')
      .update({ name: body.name, updated_at: new Date().toISOString() })
      .eq('id', contactId)
      .eq('clerk_org_id', tenant.orgId)
      .select('*')
      .single()

    if (error || !data) throw apiError(404, 'Contato nao encontrado neste time.')

    return { data }
  } catch (error) {
    throw normalizeError(error)
  }
})
