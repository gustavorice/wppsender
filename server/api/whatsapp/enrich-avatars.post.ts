import { z } from 'zod'
import { getServerSupabase } from '~~/server/utils/supabase'
import { requireOrgAdmin } from '~~/server/utils/auth'
import { fetchContactProfile } from '~~/server/utils/evolution'
import { apiError, normalizeError } from '~~/server/utils/errors'
import { rateLimit } from '~~/server/utils/rateLimit'
import { isRealPhone } from '~~/server/utils/jid'

const schema = z.object({
  whatsapp_account_id: z.string().uuid()
})

// Bulk-fetch profile pictures + display names for every contact that doesn't
// have one yet. Used when Evolution's initial findContacts response had
// profilePicUrl=null for most contacts (very common when the WhatsApp account
// is freshly connected — Baileys hasn't lazy-loaded the pics yet). Runs in
// parallel with a small concurrency limit so we don't slam Evolution's API.
//
// Writes:
//   - `avatar_url` when the row had none and Evolution returned one
//   - `push_name`  when the row had no agenda name AND Evolution returned a
//                  usable pushName (non-Você, non-digits). Never writes to
//                  `name` — that is reserved for agenda contacts.
export default defineEventHandler(async (event) => {
  try {
    await rateLimit(event, 'whatsapp:enrich-avatars', 2, 60)
    const tenant = requireOrgAdmin(event)
    const body = schema.parse(await readBody(event))
    const supabase = getServerSupabase()

    const { data: account, error: accountErr } = await supabase
      .from('whatsapp_accounts')
      .select('*')
      .eq('id', body.whatsapp_account_id)
      .eq('clerk_org_id', tenant.orgId)
      .single()
    if (accountErr || !account) throw apiError(404, 'Conta nao encontrada.')
    if (account.status !== 'connected') throw apiError(409, 'Conecte o numero antes de buscar fotos.')

    // Pull contacts that are missing avatar OR have no name AND no push_name —
    // those are the ones the UI is rendering as "Contato" / placeholder.
    const { data: contacts, error: listErr } = await supabase
      .from('contacts')
      .select('id, wa_id, phone, name, push_name, avatar_url')
      .eq('clerk_org_id', tenant.orgId)
      .eq('whatsapp_account_id', account.id)
      .or('avatar_url.is.null,name.is.null,push_name.is.null')
      .limit(1000)
    if (listErr) throw listErr

    const targets = contacts || []
    const concurrency = 8
    let attempted = 0
    let updatedAvatars = 0
    let updatedPushnames = 0

    async function processOne(c: {
      id: string
      wa_id: string
      phone: string | null
      name: string | null
      push_name: string | null
      avatar_url: string | null
    }) {
      attempted += 1
      const isLid = !isRealPhone(c.wa_id)
      const profile = await fetchContactProfile(account.instance_name, c.phone || c.wa_id, {
        isLid,
        timeoutMs: 5000
      }).catch(() => null)
      if (!profile) return

      const patch: Record<string, unknown> = {}
      let didAvatar = false
      let didPushname = false

      if (!c.avatar_url && profile.avatarUrl) {
        patch.avatar_url = profile.avatarUrl
        didAvatar = true
      }

      // Persist agenda name when we learned one and the row was empty. This
      // is rare from Evolution (findContacts mostly returns pushName), but
      // worth handling.
      if (!c.name && profile.name) {
        patch.name = profile.name
      }

      // Persist pushName separately so the UI can fall back to it via
      // contactDisplayName() while keeping `name` reserved for agenda names.
      if (!c.push_name && profile.pushName) {
        patch.push_name = profile.pushName
        didPushname = true
      }

      if (Object.keys(patch).length === 0) return
      patch.updated_at = new Date().toISOString()
      const { error } = await supabase
        .from('contacts')
        .update(patch)
        .eq('id', c.id)
        .eq('clerk_org_id', tenant.orgId)
      if (!error) {
        if (didAvatar) updatedAvatars += 1
        if (didPushname) updatedPushnames += 1
      }
    }

    // Manual semaphore loop instead of pulling a dependency
    const queue = [...targets]
    const workers = Array.from({ length: concurrency }, async () => {
      while (queue.length > 0) {
        const next = queue.shift()
        if (!next) break
        await processOne(next as any)
      }
    })
    await Promise.all(workers)

    return {
      data: {
        scanned: targets.length,
        attempted,
        updated_avatars: updatedAvatars,
        updated_pushnames: updatedPushnames
      }
    }
  } catch (error) {
    throw normalizeError(error)
  }
})
