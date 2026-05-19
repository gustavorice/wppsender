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
  const phone = remoteJid ? normalizePhone(remoteJid) : normalizePhone(pickString(record.phone, record.participant) || '')

  if (!phone) {
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
    name: pickString(record.pushName, record.name, record.senderName, record.notifyName),
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

  if (!parsed.message) {
    return {
      ok: true,
      account_id: account.id,
      event_type: parsed.eventType,
      message_id: null
    }
  }

  const message = parsed.message

  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .upsert(
      {
        clerk_org_id: account.clerk_org_id,
        whatsapp_account_id: account.id,
        wa_id: message.waId,
        phone: message.phone,
        name: message.name,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'clerk_org_id,whatsapp_account_id,wa_id' }
    )
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
      {
        onConflict: 'clerk_org_id,whatsapp_account_id,wa_message_id',
        ignoreDuplicates: true
      }
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
    .update({
      last_message_at: message.sentAt
    })
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
