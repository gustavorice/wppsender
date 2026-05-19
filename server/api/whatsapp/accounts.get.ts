import { getServerSupabase } from '~~/server/utils/supabase'
import { requireTenantAuth } from '~~/server/utils/auth'
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

    return { data: data || [] }
  } catch (error) {
    throw normalizeError(error)
  }
})
