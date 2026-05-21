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
              'MESSAGES_DELETE',
              'SEND_MESSAGE',
              'CHATS_SET',
              'CHATS_UPSERT',
              'CHATS_UPDATE',
              'CHATS_DELETE',
              'CONTACTS_SET',
              'CONTACTS_UPSERT',
              'CONTACTS_UPDATE',
              'PRESENCE_UPDATE'
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
  pushName: string | null
}

// Quick per-contact lookup used to enrich a contact on first inbound message,
// so the UI gets the real name + profile picture without waiting for the next
// CONTACTS_SET batch. Works for both @s.whatsapp.net and @lid identifiers.
//
// Fallback order (all attempted in parallel, capped by `timeoutMs`):
//   1. /chat/findContacts where { remoteJid: phone@s.whatsapp.net }
//      → returns pushName + profilePicUrl from Evolution's DB
//   2. /chat/findContacts where { remoteJid: phone@lid }
//      → same shape but for the LID twin of the contact
//   3. /chat/whatsappNumbers with the bare phone (skipped for LIDs)
//      → returns the verifiedName / business name
//   4. /chat/fetchProfilePictureUrl with the bare phone
//      → returns just the avatar
//   5. /chat/fetchProfilePictureUrl with phone@s.whatsapp.net
//      → JID form, sometimes succeeds when bare phone doesn't
//   6. /chat/fetchProfilePictureUrl with phone@lid
//      → LID form
//
// We merge the results: first non-null `name` (the agenda name), first
// non-null `pushName` (the WhatsApp display name set by the contact),
// and first non-null `avatarUrl`. Returning pushName separately lets the
// caller persist it to `contacts.push_name` even when there is no
// agenda name available.
export async function fetchContactProfile(
  instanceName: string,
  phone: string,
  options: { isLid?: boolean; timeoutMs?: number } = {}
): Promise<EvolutionContactProfile> {
  const config = getEvolutionConfig()
  if (config.isMock || !phone) {
    return { name: null, avatarUrl: null, pushName: null }
  }

  const isLid = Boolean(options.isLid)
  const timeoutMs = options.timeoutMs ?? 5000

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)

  function sanitizeName(raw: string | null | undefined): string | null {
    if (!raw) return null
    const trimmed = raw.trim()
    if (!trimmed) return null
    if (trimmed.toLowerCase() === 'voce' || trimmed === 'Você') return null
    const digits = trimmed.replace(/\D/g, '')
    if (digits && (digits === phone || digits.startsWith(phone) || phone.startsWith(digits))) return null
    return trimmed
  }

  async function tryFindContactsBy(remoteJid: string): Promise<{ name: string | null; pushName: string | null; avatarUrl: string | null }> {
    try {
      const res = await fetch(`${config.apiUrl}/chat/findContacts/${encodeURIComponent(instanceName)}`, {
        method: 'POST',
        headers: { apikey: config.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ where: { remoteJid } }),
        signal: ac.signal
      })
      if (!res.ok) return { name: null, pushName: null, avatarUrl: null }
      const arr = (await res.json()) as Array<{
        pushName?: string
        name?: string
        verifiedName?: string
        businessName?: string
        profilePicUrl?: string
      }>
      const first = arr?.[0]
      if (!first) return { name: null, pushName: null, avatarUrl: null }
      // `name` field in Evolution's DB is the agenda/contact name (set by
      // the user). `pushName` is the public WhatsApp display name set by
      // the contact themselves. Keep them separate.
      const name = sanitizeName(first.name || first.verifiedName || first.businessName)
      const pushName = sanitizeName(first.pushName)
      const avatarUrl = first.profilePicUrl?.trim() || null
      return { name, pushName, avatarUrl }
    } catch {
      return { name: null, pushName: null, avatarUrl: null }
    }
  }

  async function tryNumbers(): Promise<string | null> {
    // whatsappNumbers only accepts real phone numbers — skip for LIDs.
    if (isLid) return null
    try {
      const res = await fetch(`${config.apiUrl}/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`, {
        method: 'POST',
        headers: { apikey: config.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ numbers: [phone] }),
        signal: ac.signal
      })
      if (!res.ok) return null
      const arr = (await res.json()) as Array<{ name?: string }>
      return sanitizeName(arr?.[0]?.name)
    } catch {
      return null
    }
  }

  async function tryPictureFor(numberOrJid: string): Promise<string | null> {
    try {
      const res = await fetch(`${config.apiUrl}/chat/fetchProfilePictureUrl/${encodeURIComponent(instanceName)}`, {
        method: 'POST',
        headers: { apikey: config.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: numberOrJid }),
        signal: ac.signal
      })
      if (!res.ok) return null
      const data = (await res.json()) as { profilePictureUrl?: string }
      return data?.profilePictureUrl?.trim() || null
    } catch {
      return null
    }
  }

  const [findPhone, findLid, numbersName, picBare, picPhoneJid, picLidJid] = await Promise.all([
    tryFindContactsBy(`${phone}@s.whatsapp.net`),
    tryFindContactsBy(`${phone}@lid`),
    tryNumbers(),
    tryPictureFor(phone),
    tryPictureFor(`${phone}@s.whatsapp.net`),
    isLid ? tryPictureFor(`${phone}@lid`) : Promise.resolve(null)
  ])
  clearTimeout(timer)

  // Merge: first non-null wins. The findContacts endpoints are queried for
  // both the @s.whatsapp.net and @lid twins because Evolution stores them
  // as separate rows.
  const name = findPhone.name || findLid.name || numbersName || null
  const pushName = findPhone.pushName || findLid.pushName || null
  const avatarUrl =
    findPhone.avatarUrl || findLid.avatarUrl || picBare || picPhoneJid || picLidJid || null
  return { name, avatarUrl, pushName }
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
    const senderPn = pickString(key.senderPn) || pickString(key.participantPn)
    const altJid = pickString(key.remoteJidAlt)
    const primaryJid = pickString(key.remoteJid)
    let jid: string | null = null
    if (senderPn) {
      jid = senderPn.includes('@') ? senderPn : `${senderPn.replace(/\D/g, '')}@s.whatsapp.net`
    } else if (altJid && altJid.includes('@s.whatsapp.net')) jid = altJid
    else if (primaryJid && primaryJid.includes('@s.whatsapp.net')) jid = primaryJid
    else if (primaryJid && primaryJid.includes('@lid')) jid = primaryJid
    else if (remoteJid.includes('@s.whatsapp.net') || remoteJid.includes('@lid')) jid = remoteJid
    if (!jid) continue
    if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter')) continue
    const phone = jid.replace(/@.+$/, '').replace(/\D/g, '')
    if (!phone || phone.length < 5 || phone.length > 18) continue

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

// Pull every stored message for the instance (paginated). Used to mass-import
// everything Evolution has, then dispatch each message into its own
// conversation based on the resolved real JID.
export async function fetchAllMessages(instanceName: string, maxPages = 20): Promise<EvolutionHistoryMessage[]> {
  const config = getEvolutionConfig()
  if (config.isMock) return []

  const out: EvolutionHistoryMessage[] = []
  const perPage = 50

  for (let page = 1; page <= maxPages; page++) {
    let raw: any
    try {
      raw = await evolutionFetch<any>(`/chat/findMessages/${encodeURIComponent(instanceName)}`, {
        method: 'POST',
        body: { where: {}, page, offset: perPage }
      })
    } catch {
      break
    }
    const msgs = raw?.messages
    const records: any[] = msgs?.records || (Array.isArray(raw) ? raw : raw?.records || [])
    if (records.length === 0) break

    for (const record of records) {
      const key = record?.key || {}
      const senderPn = pickString(key.senderPn) || pickString(key.participantPn)
      const altJid = pickString(key.remoteJidAlt)
      const primaryJid = pickString(key.remoteJid)
      // Real phone resolution priority: senderPn > remoteJidAlt > remoteJid.
      // @lid still accepted as last resort so Business chats survive.
      let jid: string | null = null
      if (senderPn) {
        jid = senderPn.includes('@') ? senderPn : `${senderPn.replace(/\D/g, '')}@s.whatsapp.net`
      } else if (altJid && altJid.includes('@s.whatsapp.net')) jid = altJid
      else if (primaryJid && primaryJid.includes('@s.whatsapp.net')) jid = primaryJid
      else if (primaryJid && primaryJid.includes('@lid')) jid = primaryJid
      if (!jid) continue
      if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter')) continue
      const phone = jid.replace(/@.+$/, '').replace(/\D/g, '')
      if (!phone || phone.length < 5 || phone.length > 18) continue

      const waMessageId = pickString(key.id) || pickString(record?.messageId) || `histo_${phone}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
      const fromMe = Boolean(key.fromMe)
      const ts = record?.messageTimestamp || record?.timestamp || record?.date
      const sentAt = ts
        ? new Date(typeof ts === 'number' ? (ts > 9999999999 ? ts : ts * 1000) : Date.parse(String(ts))).toISOString()
        : new Date().toISOString()
      const classified = classifyMessage(record)
      const rawPush = firstString(record?.pushName, record?.notifyName)
      // Treat the LID-as-pushName fallback ("58317535740100") as no name
      const pushName = rawPush && rawPush !== phone ? cleanName(rawPush, phone) : null

      out.push({
        waMessageId,
        fromMe,
        remoteJid: jid,
        phone,
        pushName,
        body: classified.body,
        mediaUrl: classified.mediaUrl,
        type: classified.type,
        sentAt,
        raw: record
      })
    }

    // Stop if we got fewer than perPage rows (last page).
    if (records.length < perPage) break
    // Stop if Evolution tells us we're past the last page.
    const totalPages = msgs?.pages
    if (typeof totalPages === 'number' && page >= totalPages) break
  }

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
