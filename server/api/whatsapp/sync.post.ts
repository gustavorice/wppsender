import { z } from 'zod'
import { getServerSupabase } from '~~/server/utils/supabase'
import { requireOrgAdmin } from '~~/server/utils/auth'
import { fetchContacts } from '~~/server/utils/evolution'
import { normalizeError } from '~~/server/utils/errors'
import { rateLimit } from '~~/server/utils/rateLimit'

const schema = z.object({
  whatsapp_account_id: z.string().uuid()
})

export default defineEventHandler(async (event) => {
  try {
    await rateLimit(event, 'whatsapp:sync', 4, 60)

    const tenant = requireOrgAdmin(event)
    const body = schema.parse(await readBody(event))
    const supabase = getServerSupabase()

    const { data: account, error: accountError } = await supabase
      .from('whatsapp_accounts')
      .select('*')
      .eq('id', body.whatsapp_account_id)
      .eq('clerk_org_id', tenant.orgId)
      .single()

    if (accountError || !account) {
      throw createError({ statusCode: 404, statusMessage: 'Conta WhatsApp nao encontrada nessa organizacao.' })
    }

    if (account.status !== 'connected') {
      throw createError({ statusCode: 409, statusMessage: 'Conecte o numero antes de sincronizar contatos.' })
    }

    const evolutionContacts = await fetchContacts(account.instance_name)

    if (evolutionContacts.length === 0) {
      return { data: { synced: 0, account_id: account.id } }
    }

    const seen = new Set<string>()
    const rows = evolutionContacts
      .filter((contact) => {
        if (seen.has(contact.waId)) return false
        seen.add(contact.waId)
        return true
      })
      .map((contact) => ({
        clerk_org_id: account.clerk_org_id,
        whatsapp_account_id: account.id,
        wa_id: contact.waId,
        phone: contact.phone,
        name: contact.name || contact.pushName,
        avatar_url: contact.avatarUrl,
        updated_at: new Date().toISOString()
      }))

    const chunkSize = 500
    let saved = 0
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize)
      const { error: upsertError } = await supabase
        .from('contacts')
        .upsert(chunk, { onConflict: 'clerk_org_id,whatsapp_account_id,wa_id' })

      if (upsertError) {
        throw upsertError
      }

      saved += chunk.length
    }

    return { data: { synced: saved, account_id: account.id } }
  } catch (error) {
    throw normalizeError(error)
  }
})
