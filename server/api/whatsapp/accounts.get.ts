import { getServerSupabase } from '~~/server/utils/supabase'
import { requireTenantAuth } from '~~/server/utils/auth'
import { getConnectionState, isEvolutionMock } from '~~/server/utils/evolution'
import { normalizeError } from '~~/server/utils/errors'

export default defineEventHandler(async (event) => {
  try {
    const tenant = requireTenantAuth(event)
    const supabase = getServerSupabase()

    const { data, error } = await supabase
      .from('whatsapp_accounts')
      .select('*')
      .eq('clerk_org_id', tenant.orgId)
      .order('created_at', { ascending: false })

    if (error) {
      throw error
    }

    const accounts = data || []

    // Reconcile DB status with Evolution's real-time state. Without this the
    // dashboard's "Conectados" counter drifts when Evolution loses a session
    // but the webhook never fires (network glitches, container restarts, etc).
    if (!isEvolutionMock() && accounts.length > 0) {
      await Promise.all(
        accounts.map(async (acc) => {
          try {
            const state = await getConnectionState(acc.instance_name)
            const newStatus = state.status
            const newPhone = state.phoneNumber || acc.phone_number
            if (newStatus && (newStatus !== acc.status || newPhone !== acc.phone_number)) {
              await supabase
                .from('whatsapp_accounts')
                .update({
                  status: newStatus,
                  phone_number: newPhone,
                  ...(newStatus === 'connected' && acc.status !== 'connected'
                    ? { last_connected_at: new Date().toISOString(), qr_code: null }
                    : {})
                })
                .eq('id', acc.id)
                .eq('clerk_org_id', tenant.orgId)

              acc.status = newStatus
              acc.phone_number = newPhone
            }
          } catch {
            // Evolution call failed for this account; keep stale DB status
          }
        })
      )
    }

    return { data: accounts }
  } catch (error) {
    throw normalizeError(error)
  }
})
