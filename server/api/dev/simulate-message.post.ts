import { z } from 'zod'
import { getServerSupabase } from '~~/server/utils/supabase'
import { requireTenantAuth } from '~~/server/utils/auth'
import { apiError, normalizeError } from '~~/server/utils/errors'
import { processEvolutionWebhook } from '~~/server/utils/evolutionWebhook'
import { isEvolutionMock } from '~~/server/utils/evolution'

const schema = z.object({
  whatsapp_account_id: z.string().uuid(),
  phone: z.string().trim().min(6).default('5511999999999'),
  name: z.string().trim().min(1).default('Cliente Demo'),
  body: z.string().trim().min(1).default('Mensagem simulada do modo desenvolvimento.')
})

export default defineEventHandler(async (event) => {
  try {
    if (!isEvolutionMock()) {
      throw apiError(404, 'Endpoint de simulacao disponivel apenas sem EVOLUTION_API_URL/EVOLUTION_API_KEY.')
    }

    const tenant = requireTenantAuth(event)
    const body = schema.parse(await readBody(event))
    const supabase = getServerSupabase()

    const { data: account, error } = await supabase
      .from('whatsapp_accounts')
      .select('*')
      .eq('id', body.whatsapp_account_id)
      .eq('clerk_org_id', tenant.orgId)
      .single()

    if (error || !account) {
      throw apiError(404, 'Conta de WhatsApp nao encontrada.')
    }

    const payload = {
      event: 'MESSAGES_UPSERT',
      instance: account.instance_name,
      data: {
        key: {
          id: `mock_in_${crypto.randomUUID()}`,
          remoteJid: `${body.phone.replace(/\D/g, '')}@s.whatsapp.net`,
          fromMe: false
        },
        pushName: body.name,
        message: {
          conversation: body.body
        },
        messageTimestamp: Math.floor(Date.now() / 1000)
      }
    }

    return processEvolutionWebhook(payload)
  } catch (error) {
    throw normalizeError(error)
  }
})
