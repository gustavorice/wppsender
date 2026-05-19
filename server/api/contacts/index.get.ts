import { getQuery } from 'h3'
import { getServerSupabase } from '~~/server/utils/supabase'
import { requireTenantAuth } from '~~/server/utils/auth'
import { normalizeError } from '~~/server/utils/errors'

export default defineEventHandler(async (event) => {
  try {
    const tenant = requireTenantAuth(event)
    const query = getQuery(event)
    const search = typeof query.search === 'string' ? query.search.trim() : ''
    const whatsappAccountId = typeof query.whatsapp_account_id === 'string' ? query.whatsapp_account_id : ''
    const supabase = getServerSupabase()

    let request = supabase
      .from('contacts')
      .select('*')
      .eq('clerk_org_id', tenant.orgId)
      .order('updated_at', { ascending: false })
      .limit(100)

    if (whatsappAccountId) {
      request = request.eq('whatsapp_account_id', whatsappAccountId)
    }

    if (search) {
      request = request.or(`name.ilike.%${search}%,phone.ilike.%${search}%,wa_id.ilike.%${search}%`)
    }

    const { data, error } = await request

    if (error) {
      throw error
    }

    return { data: data || [] }
  } catch (error) {
    throw normalizeError(error)
  }
})
