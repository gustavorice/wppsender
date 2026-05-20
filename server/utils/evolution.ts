import { apiError } from './errors'

export interface EvolutionConnectResult {
  qrCode: string | null
  state?: string | null
  raw?: unknown
}

export interface EvolutionSendMessageResult {
  waMessageId: string | null
  raw?: unknown
}

export interface EvolutionConnectionState {
  status: 'connected' | 'pending' | 'disconnected' | 'error'
  phoneNumber?: string | null
  raw?: unknown
}

function getEvolutionConfig() {
  const config = useRuntimeConfig()
  const apiUrl = String(config.evolutionApiUrl || '').replace(/\/$/, '')
  const apiKey = String(config.evolutionApiKey || '')
  const webhookUrl = String(config.evolutionWebhookUrl || '')

  return {
    apiUrl,
    apiKey,
    webhookUrl,
    isMock: !apiUrl || !apiKey
  }
}

export function isEvolutionMock(): boolean {
  return getEvolutionConfig().isMock
}

async function evolutionFetch<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const config = getEvolutionConfig()

  if (config.isMock) {
    throw apiError(500, 'Evolution API mock chamado no adapter real.')
  }

  const response = await fetch(`${config.apiUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: config.apiKey,
      'Content-Type': 'application/json'
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  })

  if (!response.ok) {
    throw apiError(response.status, `Evolution API respondeu ${response.status}`)
  }

  return (await response.json()) as T
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function extractQrCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const record = payload as Record<string, any>
  return (
    pickString(record.base64) ||
    pickString(record.qrcode) ||
    pickString(record.qrCode) ||
    pickString(record.code) ||
    pickString(record.pairingCode) ||
    pickString(record.data?.base64) ||
    pickString(record.data?.qrcode) ||
    pickString(record.data?.qrCode) ||
    pickString(record.data?.code) ||
    pickString(record.instance?.qrcode) ||
    null
  )
}

function normalizeConnectionState(payload: unknown): EvolutionConnectionState {
  const record = (payload || {}) as Record<string, any>
  const source = record.instance || record.data || record
  const rawStatus = String(source.state || source.status || record.state || record.status || '').toLowerCase()

  if (['open', 'connected', 'connect'].includes(rawStatus)) {
    return { status: 'connected', phoneNumber: pickString(source.phoneNumber || source.number || source.profileName), raw: payload }
  }

  if (['connecting', 'pending', 'qrcode', 'qr', 'loading'].includes(rawStatus)) {
    return { status: 'pending', raw: payload }
  }

  if (['close', 'closed', 'disconnected', 'logout', 'logged_out'].includes(rawStatus)) {
    return { status: 'disconnected', raw: payload }
  }

  return { status: rawStatus ? 'error' : 'pending', raw: payload }
}

function extractMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const record = payload as Record<string, any>
  return (
    pickString(record.key?.id) ||
    pickString(record.data?.key?.id) ||
    pickString(record.message?.key?.id) ||
    pickString(record.id) ||
    pickString(record.messageId) ||
    null
  )
}

async function mockCreateInstance(instanceName: string): Promise<unknown> {
  return {
    mock: true,
    instance: {
      instanceName,
      status: 'created'
    }
  }
}

async function mockConnectInstance(instanceName: string): Promise<EvolutionConnectResult> {
  return {
    qrCode: `mock-evolution-qr:${instanceName}:${Date.now()}`,
    state: 'open',
    raw: {
      mock: true,
      instanceName,
      state: 'open'
    }
  }
}

export async function createInstance(instanceName: string): Promise<unknown> {
  const config = getEvolutionConfig()

  if (config.isMock) {
    return mockCreateInstance(instanceName)
  }

  return evolutionFetch('/instance/create', {
    method: 'POST',
    body: {
      instanceName,
      qrcode: false,
      integration: 'WHATSAPP-BAILEYS',
      syncFullHistory: true,
      webhook: config.webhookUrl
        ? {
            url: config.webhookUrl,
            enabled: true,
            byEvents: false,
            base64: true,
            events: [
              'APPLICATION_STARTUP',
              'QRCODE_UPDATED',
              'CONNECTION_UPDATE',
              'MESSAGES_SET',
              'MESSAGES_UPSERT',
              'MESSAGES_UPDATE',
              'SEND_MESSAGE',
              'CHATS_SET',
              'CHATS_UPSERT',
              'CHATS_UPDATE',
              'CONTACTS_SET',
              'CONTACTS_UPSERT',
              'CONTACTS_UPDATE'
            ]
          }
        : undefined
    }
  })
}

export interface EvolutionContact {
  jid: string
  waId: string
  phone: string
  name: string | null
  pushName: string | null
  avatarUrl: string | null
}

function cleanName(name: string | null, phone: string): string | null {
  if (!name) return null
  const trimmed = name.trim()
  if (!trimmed) return null
  if (trimmed.toLowerCase() === 'voce' || trimmed === 'Você') return null
  const digits = trimmed.replace(/\D/g, '')
  if (digits && (digits === phone || digits.startsWith(phone) || phone.startsWith(digits))) {
    return null
  }
  return trimmed
}

function normalizeRawContact(record: any): EvolutionContact | null {
  if (!record || typeof record !== 'object') {
    return null
  }

  // Evolution v2.3 also returns CUIDs as `id` here. We require a JID — a
  // string with "@" — and prefer fields that semantically hold the JID.
  const jid =
    pickString(record.remoteJid) ||
    pickString(record.jid) ||
    pickString(record.whatsappJid) ||
    pickString(record.id) ||
    pickString(record.contactId) ||
    pickString(record._id)

  if (!jid || !jid.includes('@')) {
    return null
  }

  // Reject WhatsApp Business virtual identifiers (@lid, @newsletter, @bot)
  // and group/broadcast JIDs. These create shadow contacts.
  if (
    jid.includes('@g.us') ||
    jid.includes('@broadcast') ||
    jid === 'status@broadcast' ||
    jid.includes('@lid') ||
    jid.includes('@newsletter') ||
    jid.includes('@bot')
  ) {
    return null
  }

  const phone = jid.replace(/@.+$/, '').replace(/\D/g, '')
  if (!phone || phone.length < 10 || phone.length > 13) {
    return null
  }

  const rawName = pickString(record.name) || pickString(record.verifiedName) || pickString(record.businessName) || pickString(record.notify)
  const rawPush = pickString(record.pushName) || pickString(record.pushname)

  return {
    jid,
    waId: phone,
    phone,
    name: cleanName(rawName, phone),
    pushName: cleanName(rawPush, phone),
    avatarUrl: pickString(record.profilePicUrl) || pickString(record.avatarUrl) || pickString(record.imgUrl)
  }
}

export interface EvolutionContactProfile {
  name: string | null
  avatarUrl: string | null
}

// Quick per-contact lookup used to enrich a contact on first inbound message,
// so the UI gets the real name + profile picture without waiting for the next
// CONTACTS_SET batch. Runs with a tight timeout so the webhook response stays
// fast even when Evolution lags.
export async function fetchContactProfile(instanceName: string, phone: string, timeoutMs = 2500): Promise<EvolutionContactProfile> {
  const config = getEvolutionConfig()
  if (config.isMock || !phone) {
    return { name: null, avatarUrl: null }
  }

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)

  async function tryNumbers(): Promise<string | null> {
    try {
      const res = await fetch(`${config.apiUrl}/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`, {
        method: 'POST',
        headers: { apikey: config.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ numbers: [phone] }),
        signal: ac.signal
      })
      if (!res.ok) return null
      const arr = (await res.json()) as Array<{ name?: string }>
      const candidate = arr?.[0]?.name?.trim()
      if (!candidate) return null
      const digits = candidate.replace(/\D/g, '')
      if (digits && (digits === phone || digits.startsWith(phone) || phone.startsWith(digits))) return null
      if (candidate.toLowerCase() === 'voce' || candidate === 'Você') return null
      return candidate
    } catch {
      return null
    }
  }

  async function tryPicture(): Promise<string | null> {
    try {
      const res = await fetch(`${config.apiUrl}/chat/fetchProfilePictureUrl/${encodeURIComponent(instanceName)}`, {
        method: 'POST',
        headers: { apikey: config.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: phone }),
        signal: ac.signal
      })
      if (!res.ok) return null
      const data = (await res.json()) as { profilePictureUrl?: string }
      return data?.profilePictureUrl?.trim() || null
    } catch {
      return null
    }
  }

  const [name, avatarUrl] = await Promise.all([tryNumbers(), tryPicture()])
  clearTimeout(timer)
  return { name, avatarUrl }
}

export interface EvolutionChat {
  jid: string
  waId: string
  phone: string
  name: string | null
  lastMessageAt: string | null
}

export async function fetchChats(instanceName: string): Promise<EvolutionChat[]> {
  const config = getEvolutionConfig()
  if (config.isMock) return []

  let raw: unknown
  try {
    raw = await evolutionFetch<unknown>(`/chat/findChats/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      body: { where: {} }
    })
  } catch {
    return []
  }

  const list = Array.isArray(raw) ? raw : (raw as any)?.chats || (raw as any)?.data || []
  const out: EvolutionChat[] = []
  for (const item of list as any[]) {
    // CRITICAL: Evolution v2.3 returns its DB primary key as `id` (a CUID
    // like "cmpd63ciq00jus54cmhnstzwt"). Never fall back to `id` — only the
    // explicit JID fields contain a real WhatsApp identifier, and a valid
    // JID MUST contain "@" (e.g. "5519...@s.whatsapp.net").
    const jid = pickString(item?.remoteJid) || pickString(item?.jid) || pickString(item?.whatsappJid)
    if (!jid || !jid.includes('@')) continue
    if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@lid') || jid.includes('@newsletter')) continue
    const phone = jid.replace(/@.+$/, '').replace(/\D/g, '')
    if (!phone || phone.length < 10 || phone.length > 13) continue

    const rawName = pickString(item?.name) || pickString(item?.subject) || pickString(item?.pushName)
    const tsCandidate = item?.conversationTimestamp || item?.lastMessageRecvTimestamp || item?.lastMessageTimestamp || item?.updatedAt
    let lastMessageAt: string | null = null
    if (tsCandidate) {
      const ts = typeof tsCandidate === 'number'
        ? (tsCandidate > 9999999999 ? tsCandidate : tsCandidate * 1000)
        : Date.parse(String(tsCandidate))
      if (Number.isFinite(ts)) {
        lastMessageAt = new Date(ts).toISOString()
      }
    }

    out.push({
      jid,
      waId: phone,
      phone,
      name: cleanName(rawName, phone),
      lastMessageAt
    })
  }
  return out
}

export interface EvolutionHistoryMessage {
  waMessageId: string
  fromMe: boolean
  remoteJid: string
  phone: string
  pushName: string | null
  body: string | null
  mediaUrl: string | null
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'unknown'
  sentAt: string
  raw: any
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim().length > 0) return v.trim()
  }
  return null
}

function classifyMessage(record: any): { type: EvolutionHistoryMessage['type']; body: string | null; mediaUrl: string | null } {
  const message = record?.message || {}
  const body = firstString(
    record?.text,
    record?.body,
    message?.conversation,
    message?.extendedTextMessage?.text,
    message?.imageMessage?.caption,
    message?.videoMessage?.caption
  )
  const mediaUrl = firstString(record?.mediaUrl, message?.imageMessage?.url, message?.videoMessage?.url, message?.audioMessage?.url, message?.documentMessage?.url)
  if (message?.imageMessage) return { type: 'image', body, mediaUrl }
  if (message?.audioMessage) return { type: 'audio', body, mediaUrl }
  if (message?.videoMessage) return { type: 'video', body, mediaUrl }
  if (message?.documentMessage) return { type: 'document', body, mediaUrl }
  if (body) return { type: 'text', body, mediaUrl }
  return { type: 'unknown', body, mediaUrl }
}

export async function fetchMessagesFromHistory(
  instanceName: string,
  remoteJid: string,
  limit = 100
): Promise<EvolutionHistoryMessage[]> {
  const config = getEvolutionConfig()
  if (config.isMock) return []

  // Evolution stores chats keyed by either @s.whatsapp.net (regular) or
  // @lid (business). We don't know which one ahead of time, so we query
  // by remoteJidAlt (the canonical phone JID) which matches business
  // chats AND falls back to the @s.whatsapp.net key for regular ones.
  // If that query returns nothing, retry with the regular remoteJid query.
  async function runQuery(where: any): Promise<any[]> {
    try {
      const r = await evolutionFetch<any>(`/chat/findMessages/${encodeURIComponent(instanceName)}`, {
        method: 'POST',
        body: { where, limit }
      })
      return r?.messages?.records || r?.records || (Array.isArray(r) ? r : [])
    } catch {
      return []
    }
  }

  let records = await runQuery({ key: { remoteJidAlt: remoteJid } })
  if (records.length === 0) {
    records = await runQuery({ key: { remoteJid } })
  }
  const out: EvolutionHistoryMessage[] = []
  for (const record of records as any[]) {
    const key = record?.key || {}
    // WhatsApp Business stores chats under @lid identifiers but ships the
    // real @s.whatsapp.net JID in key.remoteJidAlt. Prefer that when we have
    // it; fall back to the search input only as last resort. Never store
    // @lid as the contact JID — those are not real phone numbers.
    const altJid = pickString(key.remoteJidAlt)
    const primaryJid = pickString(key.remoteJid)
    let jid: string | null = null
    if (altJid && altJid.includes('@s.whatsapp.net')) jid = altJid
    else if (primaryJid && primaryJid.includes('@s.whatsapp.net')) jid = primaryJid
    else if (remoteJid.includes('@s.whatsapp.net')) jid = remoteJid
    if (!jid) continue
    if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@lid')) continue
    const phone = jid.replace(/@.+$/, '').replace(/\D/g, '')
    if (!phone || phone.length < 10 || phone.length > 13) continue

    const waMessageId = pickString(key.id) || pickString(record?.messageId) || `histo_${phone}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
    const fromMe = Boolean(key.fromMe)
    const ts = record?.messageTimestamp || record?.timestamp || record?.date
    const sentAt = ts
      ? new Date(typeof ts === 'number' ? (ts > 9999999999 ? ts : ts * 1000) : Date.parse(String(ts))).toISOString()
      : new Date().toISOString()
    const classified = classifyMessage(record)

    out.push({
      waMessageId,
      fromMe,
      remoteJid: jid,
      phone,
      pushName: cleanName(firstString(record?.pushName, record?.notifyName), phone),
      body: classified.body,
      mediaUrl: classified.mediaUrl,
      type: classified.type,
      sentAt,
      raw: record
    })
  }
  // Oldest first so the UI can scroll bottom-up naturally
  out.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime())
  return out
}

export async function fetchContacts(instanceName: string): Promise<EvolutionContact[]> {
  const config = getEvolutionConfig()

  if (config.isMock) {
    return []
  }

  let raw: unknown
  try {
    raw = await evolutionFetch<unknown>(`/chat/findContacts/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      body: { where: {} }
    })
  } catch (postError) {
    try {
      raw = await evolutionFetch<unknown>(`/chat/findContacts/${encodeURIComponent(instanceName)}`, {
        method: 'GET'
      })
    } catch (getError) {
      throw postError
    }
  }

  const list = Array.isArray(raw)
    ? raw
    : (raw as any)?.contacts || (raw as any)?.data || (raw as any)?.response?.contacts || []

  return (list as any[]).map((item) => normalizeRawContact(item)).filter(Boolean) as EvolutionContact[]
}

export async function connectInstance(instanceName: string): Promise<EvolutionConnectResult> {
  const config = getEvolutionConfig()

  if (config.isMock) {
    return mockConnectInstance(instanceName)
  }

  const raw = await evolutionFetch(`/instance/connect/${encodeURIComponent(instanceName)}`)
  return {
    qrCode: extractQrCode(raw),
    state: normalizeConnectionState(raw).status,
    raw
  }
}

export async function getConnectionState(instanceName: string): Promise<EvolutionConnectionState> {
  const config = getEvolutionConfig()

  if (config.isMock) {
    return {
      status: 'connected',
      phoneNumber: '+5500000000000',
      raw: { mock: true, instanceName, state: 'open' }
    }
  }

  const raw = await evolutionFetch(`/instance/connectionState/${encodeURIComponent(instanceName)}`)
  return normalizeConnectionState(raw)
}

export async function sendTextMessage(instanceName: string, phone: string, message: string): Promise<EvolutionSendMessageResult> {
  const config = getEvolutionConfig()

  if (config.isMock) {
    return {
      waMessageId: `mock_out_${crypto.randomUUID()}`,
      raw: {
        mock: true,
        instanceName,
        phone,
        message
      }
    }
  }

  const raw = await evolutionFetch(`/message/sendText/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: {
      number: phone,
      text: message
    }
  })

  return {
    waMessageId: extractMessageId(raw),
    raw
  }
}

export async function logoutInstance(instanceName: string): Promise<unknown> {
  const config = getEvolutionConfig()

  if (config.isMock) {
    return { mock: true, instanceName, status: 'logged_out' }
  }

  return evolutionFetch(`/instance/logout/${encodeURIComponent(instanceName)}`, {
    method: 'DELETE'
  })
}

export async function deleteInstance(instanceName: string): Promise<unknown> {
  const config = getEvolutionConfig()

  if (config.isMock) {
    return { mock: true, instanceName, status: 'deleted' }
  }

  return evolutionFetch(`/instance/delete/${encodeURIComponent(instanceName)}`, {
    method: 'DELETE'
  })
}
