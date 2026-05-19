import { getRouterParam } from 'h3'
import { getServerSupabase } from '~~/server/utils/supabase'
import { requireOrgAdmin } from '~~/server/utils/auth'
import { connectInstance, getConnectionState, isEvolutionMock } from '~~/server/utils/evolution'
import { apiError, normalizeError } from '~~/server/utils/errors'
import { rateLimit } from '~~/server/utils/rateLimit'

export default defineEventHandler(async (event) => {
  try {
    await rateLimit(event, 'whatsapp:connect', 20, 60)

    const tenant = requireOrgAdmin(event)
    const id = getRouterParam(event, 'id')

    if (!id) {
      throw apiError(400, 'ID da conta de WhatsApp nao informado.')
    }

    const supabase = getServerSupabase()
    const { data: account, error } = await supabase
      .from('whatsapp_accounts')
      .select('*')
      .eq('id', id)
      .eq('clerk_org_id', tenant.orgId)
      .single()

    if (error || !account) {
      throw apiError(404, 'Conta de WhatsApp nao encontrada.')
    }

    const connection = await connectInstance(account.instance_name)
    const state = await getConnectionState(account.instance_name).catch(() => null)
    const status = isEvolutionMock() ? 'connected' : state?.status || (connection.state === 'connected' ? 'connected' : 'pending')

    const { data: updatedAccount, error: updateError } = await supabase
      .from('whatsapp_accounts')
      .update({
        qr_code: status === 'connected' ? null : connection.qrCode,
        status,
        phone_number: state?.phoneNumber || account.phone_number,
        last_connected_at: status === 'connected' ? new Date().toISOString() : account.last_connected_at
      })
      .eq('id', id)
      .eq('clerk_org_id', tenant.orgId)
      .select('*')
      .single()

    if (updateError || !updatedAccount) {
      throw updateError
    }

    return { data: updatedAccount, mock: isEvolutionMock() }
  } catch (error) {
    throw normalizeError(error)
  }
})
