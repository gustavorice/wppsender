import { z } from 'zod'
import { getServerSupabase } from '~~/server/utils/supabase'
import { requireOrgAdmin } from '~~/server/utils/auth'
import { deleteInstance, logoutInstance } from '~~/server/utils/evolution'
import { apiError, normalizeError } from '~~/server/utils/errors'
import { rateLimit } from '~~/server/utils/rateLimit'

const schema = z.object({
  id: z.string().uuid()
})

export default defineEventHandler(async (event) => {
  try {
    await rateLimit(event, 'whatsapp:disconnect', 20, 60)

    const tenant = requireOrgAdmin(event)
    const body = schema.parse(await readBody(event))
    const supabase = getServerSupabase()

    const { data: account, error } = await supabase
      .from('whatsapp_accounts')
      .select('*')
      .eq('id', body.id)
      .eq('clerk_org_id', tenant.orgId)
      .single()

    if (error || !account) {
      throw apiError(404, 'Conta de WhatsApp nao encontrada.')
    }

    await logoutInstance(account.instance_name).catch(() => null)
    await deleteInstance(account.instance_name).catch(() => null)

    const { data: updatedAccount, error: updateError } = await supabase
      .from('whatsapp_accounts')
      .update({
        status: 'disconnected',
        qr_code: null
      })
      .eq('id', account.id)
      .eq('clerk_org_id', tenant.orgId)
      .select('*')
      .single()

    if (updateError || !updatedAccount) {
      throw updateError
    }

    return { data: updatedAccount }
  } catch (error) {
    throw normalizeError(error)
  }
})
