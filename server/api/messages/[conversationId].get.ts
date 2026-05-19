import { getRouterParam } from 'h3'
import { getServerSupabase } from '~~/server/utils/supabase'
import { requireTenantAuth } from '~~/server/utils/auth'
import { apiError, normalizeError } from '~~/server/utils/errors'

export default defineEventHandler(async (event) => {
  try {
    const tenant = requireTenantAuth(event)
    const conversationId = getRouterParam(event, 'conversationId')

    if (!conversationId) {
      throw apiError(400, 'Conversa nao informada.')
    }

    const supabase = getServerSupabase()
    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('clerk_org_id', tenant.orgId)
      .single()

    if (conversationError || !conversation) {
      throw apiError(404, 'Conversa nao encontrada neste time.')
    }

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('clerk_org_id', tenant.orgId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(300)

    if (error) {
      throw error
    }

    return { data: data || [] }
  } catch (error) {
    throw normalizeError(error)
  }
})
