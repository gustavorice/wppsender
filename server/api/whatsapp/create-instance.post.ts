import { z } from 'zod'
import { getServerSupabase } from '~~/server/utils/supabase'
import { requireOrgAdmin } from '~~/server/utils/auth'
import { generateInstanceName } from '~~/server/utils/tenant'
import { createInstance, connectInstance, isEvolutionMock } from '~~/server/utils/evolution'
import { normalizeError } from '~~/server/utils/errors'
import { rateLimit } from '~~/server/utils/rateLimit'

const schema = z.object({
  display_name: z.string().trim().min(1).max(80).optional()
})

export default defineEventHandler(async (event) => {
  try {
    await rateLimit(event, 'whatsapp:create-instance', 8, 60)

    const tenant = requireOrgAdmin(event)
    const body = schema.parse(await readBody(event).catch(() => ({})))
    const supabase = getServerSupabase()
    const instanceName = generateInstanceName(tenant.orgId)

    const { data: account, error: insertError } = await supabase
      .from('whatsapp_accounts')
      .insert({
        clerk_org_id: tenant.orgId,
        instance_name: instanceName,
        display_name: body.display_name || 'WhatsApp',
        status: 'pending',
        created_by_user_id: tenant.userId
      })
      .select('*')
      .single()

    if (insertError || !account) {
      throw insertError
    }

    try {
      await createInstance(instanceName)
      const connection = await connectInstance(instanceName)
      const status = isEvolutionMock() || connection.state === 'connected' ? 'connected' : 'pending'

      const { data: updatedAccount, error: updateError } = await supabase
        .from('whatsapp_accounts')
        .update({
          qr_code: connection.qrCode,
          status,
          last_connected_at: status === 'connected' ? new Date().toISOString() : null
        })
        .eq('id', account.id)
        .eq('clerk_org_id', tenant.orgId)
        .select('*')
        .single()

      if (updateError || !updatedAccount) {
        throw updateError
      }

      return { data: updatedAccount, mock: isEvolutionMock() }
    } catch (error) {
      await supabase
        .from('whatsapp_accounts')
        .update({ status: 'error' })
        .eq('id', account.id)
        .eq('clerk_org_id', tenant.orgId)

      throw error
    }
  } catch (error) {
    throw normalizeError(error)
  }
})
