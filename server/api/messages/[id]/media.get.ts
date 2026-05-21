import { getRouterParam } from 'h3'
import { getServerSupabase } from '~~/server/utils/supabase'
import { requireTenantAuth } from '~~/server/utils/auth'
import { apiError, normalizeError } from '~~/server/utils/errors'

// Lazy media proxy: WhatsApp media URLs (mmg.whatsapp.net/...enc) are
// encrypted blobs that need Baileys' mediaKey to decrypt. The Evolution
// endpoint /chat/getBase64FromMediaMessage handles the decrypt for us
// and returns base64.
//
// We download once via Evolution, upload to Supabase Storage under the
// `whatsapp-media` bucket (public), and rewrite messages.media_url to
// the public URL. Subsequent loads hit the CDN directly — no Evolution
// round trip.

const BUCKET = 'whatsapp-media'

interface EvolutionMediaResult {
  mediaType?: string
  fileName?: string
  base64?: string
  mimetype?: string
}

function extToMime(mime: string | null | undefined, fallbackExt = 'bin'): string {
  if (!mime) return fallbackExt
  const m = mime.split(';')[0]?.trim().toLowerCase() || ''
  const map: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
    'application/pdf': 'pdf', 'application/zip': 'zip',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx'
  }
  return map[m] || fallbackExt
}

export default defineEventHandler(async (event) => {
  try {
    const tenant = requireTenantAuth(event)
    const messageId = getRouterParam(event, 'id')
    if (!messageId) throw apiError(400, 'Mensagem não informada.')

    const supabase = getServerSupabase()
    const { data: message, error: msgErr } = await supabase
      .from('messages')
      .select('id, type, media_url, raw_payload, whatsapp_account_id, clerk_org_id')
      .eq('id', messageId)
      .eq('clerk_org_id', tenant.orgId)
      .single()

    if (msgErr || !message) throw apiError(404, 'Mensagem não encontrada.')

    // Already proxied? Just return.
    const existing = String(message.media_url || '')
    if (existing && existing.includes('/storage/v1/object/public/')) {
      return { data: { url: existing, cached: true } }
    }

    if (!['image', 'audio', 'video', 'document'].includes(String(message.type))) {
      throw apiError(400, 'Mensagem sem mídia.')
    }

    // Need the account's instance_name to call Evolution.
    const { data: account, error: accErr } = await supabase
      .from('whatsapp_accounts')
      .select('id, instance_name')
      .eq('id', message.whatsapp_account_id)
      .eq('clerk_org_id', tenant.orgId)
      .single()
    if (accErr || !account) throw apiError(404, 'Conta não encontrada.')

    const config = useRuntimeConfig()
    const apiUrl = String(config.evolutionApiUrl || '').replace(/\/$/, '')
    const apiKey = String(config.evolutionApiKey || '')
    if (!apiUrl || !apiKey) throw apiError(500, 'Evolution não configurado.')

    // Evolution accepts the whole webhook payload back. We stashed it in
    // raw_payload at persist time, so just forward it. The endpoint
    // returns { base64, mediaType, fileName, mimetype }.
    const rawPayload = message.raw_payload as Record<string, any> | null
    const evolutionBody = rawPayload?.data ? { message: { key: rawPayload.data.key, message: rawPayload.data.message } } : { message: rawPayload }

    const res = await fetch(`${apiUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(account.instance_name)}`, {
      method: 'POST',
      headers: { apikey: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(evolutionBody)
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw apiError(502, `Evolution retornou ${res.status}: ${text.slice(0, 200)}`)
    }
    const payload = (await res.json()) as EvolutionMediaResult
    if (!payload?.base64) throw apiError(502, 'Evolution não retornou base64 da mídia.')

    const buffer = Buffer.from(payload.base64, 'base64')
    const ext = extToMime(payload.mimetype || null, message.type === 'image' ? 'jpg' : message.type === 'audio' ? 'ogg' : message.type === 'video' ? 'mp4' : 'bin')
    const objectPath = `${tenant.orgId}/${account.id}/${message.id}.${ext}`

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, buffer, {
        contentType: payload.mimetype || 'application/octet-stream',
        upsert: true,
        cacheControl: '604800'
      })
    if (upErr) throw apiError(500, `Falha ao subir mídia: ${upErr.message}`)

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(objectPath)
    const publicUrl = pub.publicUrl

    await supabase
      .from('messages')
      .update({ media_url: publicUrl })
      .eq('id', message.id)
      .eq('clerk_org_id', tenant.orgId)

    return { data: { url: publicUrl, cached: false, mimetype: payload.mimetype, filename: payload.fileName } }
  } catch (error) {
    throw normalizeError(error)
  }
})
