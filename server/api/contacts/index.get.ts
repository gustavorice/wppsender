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

    // CRM page only lists "real" contacts — i.e. people saved in the
    // connected phone's WhatsApp address book (BR/internacional real
    // phones). LIDs without a resolved phone are excluded because they
    // pollute the list with raw identifiers like "+213283915231476".
    let request = supabase
      .from('contacts')
      .select('*')
      .eq('clerk_org_id', tenant.orgId)
      .order('name', { ascending: true, nullsFirst: false })
      .limit(500)

    if (whatsappAccountId) {
      request = request.eq('whatsapp_account_id', whatsappAccountId)
    }

    if (search) {
      request = request.or(`name.ilike.%${search}%,push_name.ilike.%${search}%,phone.ilike.%${search}%,wa_id.ilike.%${search}%`)
    }

    const { data, error } = await request
    if (error) throw error

    // Final filter: keep only rows that have a real phone (BR 55 + 12-13
    // digits, US 1 + 11 digits, or another known country code prefix).
    // We do this server-side so the UI never has to deal with LIDs.
    const realPhonePrefixes = new Set([
      '55', '1', '44', '49', '33', '34', '39', '31', '52', '54',
      '57', '58', '56', '51', '53', '61', '64', '82', '81', '86'
    ])
    const isRealPhone = (waId: string): boolean => {
      if (!waId) return false
      const len = waId.length
      if (waId.startsWith('55') && (len === 12 || len === 13)) return true
      if (waId.startsWith('1') && len === 11) return true
      // Any other country code (2-3 digits) + 8-11 of body
      if (len >= 10 && len <= 13) {
        const cc2 = waId.slice(0, 2)
        const cc3 = waId.slice(0, 3)
        if (realPhonePrefixes.has(cc2) || realPhonePrefixes.has(cc3)) return true
      }
      return false
    }

    const filtered = (data || []).filter((c: any) => isRealPhone(c.wa_id as string))

    return { data: filtered }
  } catch (error) {
    throw normalizeError(error)
  }
})
