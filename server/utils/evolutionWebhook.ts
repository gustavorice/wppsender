import type { MessageType, EvolutionWebhookPayload } from '~~/types/entities'
import { getServerSupabase } from './supabase'

interface ParsedEvolutionEvent {
  instanceName: string | null
  eventType: string
  connectionStatus: 'connected' | 'pending' | 'disconnected' | 'error' | null
  qrCode: string | null
  message: ParsedEvolutionMessage | null
}

interface ParsedEvolutionMessage {
  waMessageId: string
  direction: 'inbound' | 'outbound'
  waId: string
  phone: string
  name: string | null
  type: MessageType
  body: string | null
  mediaUrl: string | null
  sentAt: string
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {}
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return null
}

function normalizeEventName(value: unknown): string {
  return String(value || 'unknown')
    .replace(/[.\s-]+/g, '_')
    .toUpperCase()
}

function extractInstanceName(payload: Record<string, any>): string | null {
  return pickString(
    typeof payload.instance === 'string' ? payload.instance : null,
    payload.instanceName,
    payload.instance?.instanceName,
    payload.data?.instance,
    payload.data?.instanceName,
    payload.data?.instance?.instanceName
  )
}

function normalizeConnectionStatus(payload: Record<string, any>): ParsedEvolutionEvent['connectionStatus'] {
  const data = asRecord(payload.data)
  const instance = asRecord(payload.instance)
  const rawStatus = String(
    data.state ||
      data.status ||
      data.connection ||
      instance.state ||
      instance.status ||
      payload.state ||
      payload.status ||
      ''
  ).toLowerCase()

  if (['open', 'connected', 'connect'].includes(rawStatus)) {
    return 'connected'
  }

  if (['connecting', 'pending', 'qrcode', 'qr', 'loading'].includes(rawStatus)) {
    return 'pending'
  }

  if (['close', 'closed', 'disconnected', 'logout', 'logged_out'].includes(rawStatus)) {
    return 'disconnected'
  }

  return rawStatus ? 'error' : null
}

function extractQrCode(payload: Record<string, any>): string | null {
  const data = asRecord(payload.data)
  return pickString(
    payload.qrcode,
    payload.qrCode,
    payload.base64,
    payload.code,
    data.qrcode,
    data.qrCode,
    data.base64,
    data.code,
    data.qr?.base64
  )
}

function getMessageCandidate(payload: Record<string, any>): Record<string, any> | null {
  const data = payload.data

  if (Array.isArray(data)) {
    return asRecord(data[0])
  }

  const record = asRecord(data || payload)

  if (Array.isArray(record.messages)) {
    return asRecord(record.messages[0])
  }

  if (record.message || record.key || record.remoteJid || record.text || record.body) {
    return record
  }

  return null
}

function normalizePhone(value: string): string {
  return value.replace(/@.+$/, '').replace(/\D/g, '')
}

// WhatsApp Business uses @lid identifiers (Linked Device IDs) that masquerade
// as phone numbers but are virtual — they show up alongside the real
// @s.whatsapp.net JID and would create duplicate "shadow" contacts. Detect
// and reject anything that isn't a real WhatsApp user JID.
function isAcceptableJid(rawJid: string | null | undefined): boolean {
  if (!rawJid) return false
  const trimmed = rawJid.trim()
  if (!trimmed) return false
  if (trimmed.includes('@g.us') || trimmed.includes('@broadcast') || trimmed === 'status@broadcast') {
    return false
  }
  if (trimmed.includes('@lid') || trimmed.includes('@newsletter') || trimmed.includes('@bot')) {
    return false
  }
  return true
}

// Final safety: even with a clean JID, the resulting phone digits should look
// like a real phone (E.164 is 8-15 digits). LIDs that slip through tend to
// produce numbers outside that range.
function isAcceptablePhone(phone: string): boolean {
  if (!phone) return false
  return phone.length >= 8 && phone.length <= 15
}

// Evolution / WhatsApp Web fall back to the raw phone number as pushName /
// chat name when the contact has no profile name. That's never a useful
// display name — it just shadows the phone we already store. Detect and
// reject these so the UI can show the real phone (with formatting) or
// the contact name later, but never `"132942122721378"` as a name.
function isFakeNameForPhone(name: string | null | undefined, phone: string): boolean {
  if (!name) return true
  const digits = name.replace(/\D/g, '')
  if (!digits) return false
  return digits === phone || digits.startsWith(phone) || phone.startsWith(digits)
}

function cleanContactName(name: string | null | undefined, phone: string): string | null {
  if (!name) return null
  const trimmed = name.trim()
  if (!trimmed) return null
  if (isFakeNameForPhone(trimmed, phone)) return null
  // Strip a known sentinel that some Baileys versions emit
  if (trimmed.toLowerCase() === 'voce' || trimmed === 'Você') return null
  return trimmed
}

function timestampToIso(value: unknown): string {
  if (typeof value === 'number') {
    const milliseconds = value > 9999999999 ? value : value * 1000
    return new Date(milliseconds).toISOString()
  }

  if (typeof value === 'string') {
    const numeric = Number(value)
    if (!Number.isNaN(numeric) && numeric > 0) {
      return timestampToIso(numeric)
    }

    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString()
    }
  }

  return new Date().toISOString()
}

function detectMessageBody(record: Record<string, any>): { body: string | null; type: MessageType; mediaUrl: string | null } {
  const message = asRecord(record.message)

  const body = pickString(
    record.text,
    record.body,
    record.messageText,
    message.conversation,
    message.extendedTextMessage?.text,
    message.imageMessage?.caption,
    message.videoMessage?.caption,
    record.caption
  )

  const mediaUrl = pickString(record.mediaUrl, record.url, message.imageMessage?.url, message.videoMessage?.url, message.audioMessage?.url, message.documentMessage?.url)

  if (message.imageMessage || String(record.messageType || '').includes('image')) {
    return { body, type: 'image', mediaUrl }
  }

  if (message.audioMessage || String(record.messageType || '').includes('audio')) {
    return { body, type: 'audio', mediaUrl }
  }

  if (message.videoMessage || String(record.messageType || '').includes('video')) {
    return { body, type: 'video', mediaUrl }
  }

  if (message.documentMessage || String(record.messageType || '').includes('document')) {
    return { body, type: 'document', mediaUrl }
  }

  return { body, type: body ? 'text' : 'unknown', mediaUrl }
}

function parseMessage(payload: Record<string, any>): ParsedEvolutionMessage | null {
  const record = getMessageCandidate(payload)

  if (!record) {
    return null
  }

  const key = asRecord(record.key || record.message?.key)
  const remoteJid = pickString(key.remoteJid, record.remoteJid, record.chatId, record.from, record.number, record.sender)

  // Reject @lid / @broadcast / @g.us early — these create shadow contacts.
  if (remoteJid && !isAcceptableJid(remoteJid)) {
    return null
  }

  const phone = remoteJid ? normalizePhone(remoteJid) : normalizePhone(pickString(record.phone, record.participant) || '')

  if (!phone || !isAcceptablePhone(phone)) {
    return null
  }

  const waMessageId =
    pickString(key.id, record.id, record.messageId, record.waMessageId) ||
    `evt_${phone}_${Date.now()}_${Math.random().toString(16).slice(2)}`

  const fromMe = Boolean(key.fromMe ?? record.fromMe ?? record.message?.fromMe)
  const content = detectMessageBody(record)

  return {
    waMessageId,
    direction: fromMe ? 'outbound' : 'inbound',
    waId: phone,
    phone,
    name: cleanContactName(pickString(record.pushName, record.name, record.senderName, record.notifyName), phone),
    type: content.type,
    body: content.body,
    mediaUrl: content.mediaUrl,
    sentAt: timestampToIso(record.messageTimestamp || record.timestamp || record.date)
  }
}

export function parseEvolutionWebhook(payload: EvolutionWebhookPayload): ParsedEvolutionEvent {
  const record = asRecord(payload)
  const eventType = normalizeEventName(record.event || record.type || record.data?.event)

  return {
    instanceName: extractInstanceName(record),
    eventType,
    connectionStatus: normalizeConnectionStatus(record),
    qrCode: extractQrCode(record),
    message: parseMessage(record)
  }
}

interface WhatsAppAccountRow {
  id: string
  clerk_org_id: string
  instance_name: string
}

function extractList(payload: Record<string, any>, ...keys: string[]): any[] {
  const data = asRecord(payload.data)

  for (const key of keys) {
    if (Array.isArray(payload[key])) {
      return payload[key]
    }
    if (Array.isArray(data[key])) {
      return data[key]
    }
  }

  if (Array.isArray(payload.data)) {
    return payload.data
  }

  return []
}

function normalizeContactRecord(record: any): { waId: string; phone: string; name: string | null; avatarUrl: string | null } | null {
  if (!record || typeof record !== 'object') {
    return null
  }

  const jid =
    pickString(record.id, record.remoteJid, record.jid, record.contactId, record._id, record.key?.remoteJid)
  if (!isAcceptableJid(jid)) {
    return null
  }

  const phone = (jid as string).replace(/@.+$/, '').replace(/\D/g, '')
  if (!isAcceptablePhone(phone)) {
    return null
  }

  return {
    waId: phone,
    phone,
    name: cleanContactName(
      pickString(record.name, record.verifiedName, record.businessName, record.notify, record.pushName, record.pushname),
      phone
    ),
    avatarUrl: pickString(record.profilePicUrl, record.avatarUrl, record.imgUrl, record.picture)
  }
}

function normalizeChatRecord(record: any): { waId: string; phone: string; name: string | null; lastMessageAt: string | null } | null {
  if (!record || typeof record !== 'object') {
    return null
  }

  const jid = pickString(record.id, record.remoteJid, record.jid, record.chatId)
  if (!isAcceptableJid(jid)) {
    return null
  }

  const phone = (jid as string).replace(/@.+$/, '').replace(/\D/g, '')
  if (!isAcceptablePhone(phone)) {
    return null
  }

  const tsCandidate = record.conversationTimestamp || record.lastMessageRecvTimestamp || record.lastMessageTimestamp || record.t
  const lastMessageAt = tsCandidate ? timestampToIso(tsCandidate) : null

  return {
    waId: phone,
    phone,
    name: cleanContactName(pickString(record.name, record.subject, record.pushName, record.notify), phone),
    lastMessageAt
  }
}

async function persistContactsBatch(
  account: WhatsAppAccountRow,
  records: any[]
): Promise<{ inserted: number }> {
  const normalized = records.map((r) => normalizeContactRecord(r)).filter(Boolean) as Array<{
    waId: string
    phone: string
    name: string | null
    avatarUrl: string | null
  }>

  if (normalized.length === 0) {
    return { inserted: 0 }
  }

  const seen = new Set<string>()
  const rows = normalized
    .filter((item) => {
      if (seen.has(item.waId)) return false
      seen.add(item.waId)
      return true
    })
    .map((item) => ({
      clerk_org_id: account.clerk_org_id,
      whatsapp_account_id: account.id,
      wa_id: item.waId,
      phone: item.phone,
      name: item.name,
      avatar_url: item.avatarUrl,
      updated_at: new Date().toISOString()
    }))

  const supabase = getServerSupabase()
  const { error } = await supabase
    .from('contacts')
    .upsert(rows, { onConflict: 'clerk_org_id,whatsapp_account_id,wa_id', ignoreDuplicates: false })

  if (error) {
    throw error
  }

  return { inserted: rows.length }
}

async function persistChatsBatch(
  account: WhatsAppAccountRow,
  records: any[]
): Promise<{ conversations: number }> {
  const normalized = records.map((r) => normalizeChatRecord(r)).filter(Boolean) as Array<{
    waId: string
    phone: string
    name: string | null
    lastMessageAt: string | null
  }>

  if (normalized.length === 0) {
    return { conversations: 0 }
  }

  const supabase = getServerSupabase()
  const contactRows = normalized.map((item) => ({
    clerk_org_id: account.clerk_org_id,
    whatsapp_account_id: account.id,
    wa_id: item.waId,
    phone: item.phone,
    name: item.name,
    updated_at: new Date().toISOString()
  }))

  const { data: contacts, error: contactError } = await supabase
    .from('contacts')
    .upsert(contactRows, { onConflict: 'clerk_org_id,whatsapp_account_id,wa_id' })
    .select('id, wa_id')

  if (contactError) {
    throw contactError
  }

  const contactByWaId = new Map<string, string>()
  for (const row of contacts || []) {
    contactByWaId.set(row.wa_id as string, row.id as string)
  }

  const conversationRows = normalized.flatMap((item) => {
    const contactId = contactByWaId.get(item.waId)
    if (!contactId) return []
    return [
      {
        clerk_org_id: account.clerk_org_id,
        whatsapp_account_id: account.id,
        contact_id: contactId,
        status: 'open' as const,
        last_message_at: item.lastMessageAt,
        updated_at: new Date().toISOString()
      }
    ]
  })

  if (conversationRows.length === 0) {
    return { conversations: 0 }
  }

  const { error: convError } = await supabase
    .from('conversations')
    .upsert(conversationRows, { onConflict: 'clerk_org_id,whatsapp_account_id,contact_id' })

  if (convError) {
    throw convError
  }

  return { conversations: conversationRows.length }
}

async function persistSingleMessage(
  payload: EvolutionWebhookPayload,
  account: WhatsAppAccountRow,
  parsed: ParsedEvolutionEvent
) {
  if (!parsed.message) {
    return { ok: true, account_id: account.id, event_type: parsed.eventType, message_id: null }
  }

  const message = parsed.message
  const supabase = getServerSupabase()

  const contactPayload = {
    clerk_org_id: account.clerk_org_id,
    whatsapp_account_id: account.id,
    wa_id: message.waId,
    phone: message.phone,
    // Only set name from inbound messages (pushName of the sender == contact).
    // Outbound messages carry the OWN user's pushName ("Você"), which would
    // wrongly overwrite the contact's real name on every reply.
    ...(message.direction === 'inbound' && message.name ? { name: message.name } : {}),
    updated_at: new Date().toISOString()
  }

  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .upsert(contactPayload, { onConflict: 'clerk_org_id,whatsapp_account_id,wa_id' })
    .select('*')
    .single()

  if (contactError || !contact) {
    throw contactError
  }

  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .upsert(
      {
        clerk_org_id: account.clerk_org_id,
        whatsapp_account_id: account.id,
        contact_id: contact.id,
        status: 'open',
        last_message_at: message.sentAt,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'clerk_org_id,whatsapp_account_id,contact_id' }
    )
    .select('*')
    .single()

  if (conversationError || !conversation) {
    throw conversationError
  }

  const { data: insertedMessage, error: messageError } = await supabase
    .from('messages')
    .upsert(
      {
        clerk_org_id: account.clerk_org_id,
        whatsapp_account_id: account.id,
        conversation_id: conversation.id,
        contact_id: contact.id,
        wa_message_id: message.waMessageId,
        direction: message.direction,
        type: message.type,
        body: message.body,
        media_url: message.mediaUrl,
        raw_payload: payload as Record<string, unknown>,
        sent_at: message.sentAt
      },
      { onConflict: 'clerk_org_id,whatsapp_account_id,wa_message_id', ignoreDuplicates: true }
    )
    .select('*')
    .single()

  let savedMessage = insertedMessage

  if (messageError) {
    const { data: existingMessage } = await supabase
      .from('messages')
      .select('*')
      .eq('clerk_org_id', account.clerk_org_id)
      .eq('whatsapp_account_id', account.id)
      .eq('wa_message_id', message.waMessageId)
      .single()

    savedMessage = existingMessage
  }

  await supabase
    .from('conversations')
    .update({ last_message_at: message.sentAt })
    .eq('id', conversation.id)
    .eq('clerk_org_id', account.clerk_org_id)

  await supabase.from('message_events').insert({
    clerk_org_id: account.clerk_org_id,
    message_id: savedMessage?.id ?? null,
    event_type: parsed.eventType,
    raw_payload: payload as Record<string, unknown>
  })

  return {
    ok: true,
    account_id: account.id,
    conversation_id: conversation.id,
    message_id: savedMessage?.id ?? null,
    event_type: parsed.eventType
  }
}

async function persistMessagesBatch(
  payload: EvolutionWebhookPayload,
  account: WhatsAppAccountRow,
  records: any[],
  eventType: string
): Promise<{ messages: number }> {
  let persisted = 0

  for (const record of records) {
    const wrapped = { ...payload, event: eventType, data: record } as EvolutionWebhookPayload
    const parsed = parseEvolutionWebhook(wrapped)
    if (!parsed.message) {
      continue
    }
    try {
      await persistSingleMessage(wrapped, account, parsed)
      persisted += 1
    } catch (err) {
      // skip and continue — batch import should not fail wholesale on a single bad record
    }
  }

  return { messages: persisted }
}

export async function processEvolutionWebhook(payload: EvolutionWebhookPayload) {
  const parsed = parseEvolutionWebhook(payload)

  if (!parsed.instanceName) {
    return {
      ignored: true,
      reason: 'missing_instance_name',
      parsed
    }
  }

  const supabase = getServerSupabase()
  const { data: account, error: accountError } = await supabase
    .from('whatsapp_accounts')
    .select('*')
    .eq('instance_name', parsed.instanceName)
    .single()

  if (accountError || !account) {
    return {
      ignored: true,
      reason: 'unknown_instance',
      parsed
    }
  }

  if (parsed.connectionStatus || parsed.qrCode) {
    const update: Record<string, unknown> = {}

    if (parsed.connectionStatus) {
      update.status = parsed.connectionStatus
      if (parsed.connectionStatus === 'connected') {
        update.last_connected_at = new Date().toISOString()
        update.qr_code = null
      }
    }

    if (parsed.qrCode) {
      update.qr_code = parsed.qrCode
      update.status = 'pending'
    }

    await supabase.from('whatsapp_accounts').update(update).eq('id', account.id)
  }

  const eventType = parsed.eventType
  const record = asRecord(payload)

  if (eventType === 'CONTACTS_SET' || eventType === 'CONTACTS_UPSERT' || eventType === 'CONTACTS_UPDATE') {
    const list = extractList(record, 'contacts')
    const result = await persistContactsBatch(account as WhatsAppAccountRow, list)
    return { ok: true, account_id: account.id, event_type: eventType, ...result }
  }

  if (eventType === 'CHATS_SET' || eventType === 'CHATS_UPSERT' || eventType === 'CHATS_UPDATE') {
    const list = extractList(record, 'chats')
    const result = await persistChatsBatch(account as WhatsAppAccountRow, list)
    return { ok: true, account_id: account.id, event_type: eventType, ...result }
  }

  if (eventType === 'MESSAGES_SET') {
    const list = extractList(record, 'messages')
    const result = await persistMessagesBatch(payload, account as WhatsAppAccountRow, list, eventType)
    return { ok: true, account_id: account.id, event_type: eventType, ...result }
  }

  if (parsed.message) {
    return persistSingleMessage(payload, account as WhatsAppAccountRow, parsed)
  }

  return {
    ok: true,
    account_id: account.id,
    event_type: eventType,
    message_id: null
  }
}
