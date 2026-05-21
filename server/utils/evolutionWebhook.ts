import type { MessageType, EvolutionWebhookPayload } from '~~/types/entities'
import { getServerSupabase } from './supabase'
import { fetchContactProfile } from './evolution'
import { isAcceptableJid as _isAcceptableJid, isAcceptablePhone as _isAcceptablePhone, parseJid, isRealPhone } from './jid'

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

  // Unknown/transient states (e.g. 'refused', 'unknown', 'reconnecting') —
  // never flip an already-connected row into 'error' just because Evolution
  // emitted a state we don't have in our enum. Returning null leaves the
  // current DB value alone.
  return null
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

const isAcceptableJid = _isAcceptableJid
const isAcceptablePhone = _isAcceptablePhone

// Inspect the raw payload to figure out if the original JID was @lid. Used
// to drive the enrichment call shape (LID lookups go through different
// Evolution endpoints than regular phone lookups).
function remoteJidIsLid(payload: any): boolean {
  const data = payload?.data
  const key = data?.key || data?.message?.key || {}
  const p = parseJid(key?.remoteJid || data?.remoteJid)
  if (!p || !p.isLid) return false
  const alt = parseJid(key?.remoteJidAlt)
  if (alt && alt.isPhone) return false
  return true
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
  // WhatsApp Business resolution order (per Evolution issue #2326):
  // 1. key.senderPn / key.participantPn — real phone, set by newer Baileys
  // 2. key.remoteJidAlt — populated when the alt-JID is the @s.whatsapp.net form
  // 3. key.remoteJid — the raw addressing (often @lid for Business chats)
  // Anything else we treat as last resort and fall back to LID.
  const senderPn = pickString(key.senderPn) || pickString(key.participantPn)
  const altJid = pickString(key.remoteJidAlt)
  const primaryJid = pickString(key.remoteJid, record.remoteJid, record.chatId, record.from, record.number, record.sender)
  let remoteJid: string | null = null
  if (senderPn) {
    // senderPn comes as bare phone digits — turn it into a @s.whatsapp.net JID
    remoteJid = senderPn.includes('@') ? senderPn : `${senderPn.replace(/\D/g, '')}@s.whatsapp.net`
  } else if (altJid && altJid.includes('@s.whatsapp.net')) {
    remoteJid = altJid
  } else if (primaryJid && primaryJid.includes('@s.whatsapp.net')) {
    remoteJid = primaryJid
  } else if (primaryJid && primaryJid.includes('@lid')) {
    remoteJid = primaryJid
  } else if (primaryJid) {
    remoteJid = primaryJid
  }

  if (!remoteJid) {
    return null
  }
  // Reject group, broadcast, newsletter — but allow @lid through.
  if (remoteJid.includes('@g.us') || remoteJid.includes('@broadcast') || remoteJid.includes('@newsletter') || remoteJid.includes('@bot')) {
    return null
  }

  const phone = normalizePhone(remoteJid)
  if (!phone || phone.length < 5 || phone.length > 18) {
    return null
  }

  const waMessageId =
    pickString(key.id, record.id, record.messageId, record.waMessageId) ||
    `evt_${phone}_${Date.now()}_${Math.random().toString(16).slice(2)}`

  const fromMe = Boolean(key.fromMe ?? record.fromMe ?? record.message?.fromMe)
  const content = detectMessageBody(record)

  // For @lid messages: refuse to persist if it's outbound AND the contact
  // didn't exist before. Outbound-only @lid events create pure-noise
  // entries (no name, no avatar, no counter-party identity). The contact
  // will be created later if the person actually replies inbound.
  const isLidJid = remoteJid.includes('@lid')
  if (isLidJid && fromMe) {
    (payload as any).__skipNewLidContact = true
  }

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

// Resolve LID-like wa_ids in a batch to their real BR/intl phone equivalents
// by looking up contacts.lid_alt. Returns a map of LID -> { waId, phone } for
// every LID that has a matching BR contact. LIDs without a match are absent
// from the map (caller decides whether to keep them or drop them).
async function resolveLidsToBr(
  account: WhatsAppAccountRow,
  lidWaIds: string[]
): Promise<Map<string, { waId: string; phone: string }>> {
  const out = new Map<string, { waId: string; phone: string }>()
  if (lidWaIds.length === 0) return out

  const supabase = getServerSupabase()
  const { data, error } = await supabase
    .from('contacts')
    .select('wa_id, phone, lid_alt')
    .eq('clerk_org_id', account.clerk_org_id)
    .eq('whatsapp_account_id', account.id)
    .in('lid_alt', lidWaIds)

  if (error || !data) return out

  for (const row of data) {
    const lid = (row as any).lid_alt as string | null
    const waId = (row as any).wa_id as string | null
    const phone = (row as any).phone as string | null
    if (lid && waId) {
      out.set(lid, { waId, phone: phone || waId })
    }
  }

  return out
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

  // === LID → BR resolution (batch) ===
  // Any wa_id that doesn't look like a real phone is treated as a LID and
  // looked up against contacts.lid_alt. Resolved entries are rewritten to
  // the BR contact's wa_id/phone before the upsert, so we never recreate a
  // LID-only contact row when the BR row already exists.
  const lidsToResolve = Array.from(new Set(normalized.filter((n) => !isRealPhone(n.waId)).map((n) => n.waId)))
  const lidMap = await resolveLidsToBr(account, lidsToResolve)
  for (const item of normalized) {
    if (!isRealPhone(item.waId)) {
      const resolved = lidMap.get(item.waId)
      if (resolved) {
        item.waId = resolved.waId
        item.phone = resolved.phone
      }
    }
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

  // === LID → BR resolution (multi-step) ===
  // The canonical contacts.wa_id is ALWAYS the real phone when known. LIDs
  // ride along on contacts.lid_alt of the real-phone row — never as a
  // separate row's wa_id. Before persisting we try multiple resolution
  // paths so a known counter-party isn't duplicated as a LID row:
  //   1. Skip resolution entirely when waId is already a real phone.
  //   2. Match against contacts.lid_alt (the canonical mapping).
  //   3. Match against contacts.push_name (case-insensitive trim) for
  //      non-trivial names. Catches the case where the same person exists
  //      under BR and LID forms in the agenda.
  //   4. If the raw payload has key.remoteJidAlt ending in @s.whatsapp.net,
  //      promote that phone to wa_id directly even when the BR contact
  //      doesn't exist yet.
  // When a resolution succeeds, we always remember it by writing the LID
  // onto contacts.lid_alt so the lookup is O(1) next time.
  let resolvedWaId = message.waId
  let resolvedPhone = message.phone
  let learnedLidFromResolution: string | null = null

  // Step 1: already canonical — no resolution needed.
  if (!isRealPhone(message.waId)) {
    // Step 2: contacts.lid_alt lookup.
    const { data: lidMatch } = await supabase
      .from('contacts')
      .select('wa_id, phone')
      .eq('clerk_org_id', account.clerk_org_id)
      .eq('whatsapp_account_id', account.id)
      .eq('lid_alt', message.waId)
      .maybeSingle()
    if (lidMatch?.wa_id) {
      resolvedWaId = lidMatch.wa_id as string
      resolvedPhone = (lidMatch.phone as string) || resolvedWaId
    } else {
      // Step 3: push_name fallback — only when the name is non-trivial.
      const candidateName = message.name?.trim() || ''
      const nameDigits = candidateName.replace(/\D/g, '')
      const trivialName =
        candidateName.length < 3 ||
        candidateName.toLowerCase() === 'voce' ||
        candidateName === 'Você' ||
        (nameDigits.length > 0 && nameDigits === candidateName.replace(/\s+/g, ''))
      if (!trivialName) {
        const { data: nameMatches } = await supabase
          .from('contacts')
          .select('wa_id, phone, name, push_name')
          .eq('clerk_org_id', account.clerk_org_id)
          .eq('whatsapp_account_id', account.id)
          .or(`push_name.ilike.${candidateName},name.ilike.${candidateName}`)
          .limit(10)
        const lower = candidateName.toLowerCase()
        const real = (nameMatches || []).find((row: any) => {
          if (!isRealPhone(row.wa_id as string)) return false
          const rowPush = String(row.push_name || '').trim().toLowerCase()
          const rowName = String(row.name || '').trim().toLowerCase()
          return rowPush === lower || rowName === lower
        })
        if (real?.wa_id) {
          resolvedWaId = real.wa_id as string
          resolvedPhone = (real.phone as string) || resolvedWaId
          learnedLidFromResolution = message.waId
        }
      }

      // Step 4: raw payload's key.remoteJidAlt — promote the phone directly.
      if (!isRealPhone(resolvedWaId)) {
        try {
          const rawKey = ((payload as any)?.data?.key || {}) as Record<string, unknown>
          const rawAlt = String(rawKey.remoteJidAlt || '')
          if (rawAlt.endsWith('@s.whatsapp.net')) {
            const altPhone = rawAlt.replace('@s.whatsapp.net', '').replace(/\D/g, '')
            if (isRealPhone(altPhone)) {
              resolvedWaId = altPhone
              resolvedPhone = altPhone
              learnedLidFromResolution = message.waId
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
  }

  // For outbound-only @lid messages with no resolution AND no prior contact,
  // skip creating a "ghost" row.
  const skipNewLid = Boolean((payload as any).__skipNewLidContact)
  if (skipNewLid && resolvedWaId === message.waId) {
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .eq('clerk_org_id', account.clerk_org_id)
      .eq('whatsapp_account_id', account.id)
      .eq('wa_id', resolvedWaId)
      .maybeSingle()
    if (!existing) {
      return { ok: true, account_id: account.id, event_type: parsed.eventType, message_id: null, skipped: 'lid-outbound-no-prior' }
    }
  }

  // Replace message identity with resolved one so the rest of the function
  // writes everything to the real contact's conversation.
  message.waId = resolvedWaId
  message.phone = resolvedPhone

  // Learn LID↔phone associations when the webhook gives us both. This is
  // the cleanest way to keep the mapping fresh: every time a message
  // contains BOTH the real JID and the original @lid, we save the LID on
  // the real contact's row. We also remember LIDs we just resolved via
  // push_name / remoteJidAlt so future messages skip the lookup entirely.
  let learnedLidAlt: string | null = null
  try {
    const rawKey = ((payload as any)?.data?.key || {}) as Record<string, unknown>
    const rawRemote = String(rawKey.remoteJid || '')
    const rawAlt = String(rawKey.remoteJidAlt || '')
    if (rawRemote.endsWith('@lid') && rawAlt.endsWith('@s.whatsapp.net')) {
      learnedLidAlt = rawRemote.replace('@lid', '').replace(/\D/g, '') || null
    }
  } catch {
    /* ignore */
  }
  if (!learnedLidAlt && learnedLidFromResolution) {
    learnedLidAlt = learnedLidFromResolution
  }

  // Only set push_name from inbound messages — outbound pushName is "Você"
  // (the user themselves). Do not write `name` from webhook, because the
  // `findContacts` sync owns the agenda name field. UI falls back from
  // name -> push_name when needed.
  const contactPayload = {
    clerk_org_id: account.clerk_org_id,
    whatsapp_account_id: account.id,
    wa_id: message.waId,
    phone: message.phone,
    ...(message.direction === 'inbound' && message.name ? { push_name: message.name } : {}),
    ...(learnedLidAlt ? { lid_alt: learnedLidAlt } : {}),
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

  // Enrich contact in-band when it's still missing name / avatar — gives the
  // UI an instant picture+name on the very first message instead of waiting
  // for the next CONTACTS_SET batch (which only fires on initial sync).
  // For both @s.whatsapp.net AND @lid identifiers.
  if (!contact.name || !contact.avatar_url) {
    const isLid = (parsed.message?.waId === message.waId) && remoteJidIsLid(payload)
    const profile = await fetchContactProfile(account.instance_name, message.phone, { isLid, timeoutMs: 2500 }).catch(() => null)
    if (profile && (profile.name || profile.avatarUrl)) {
      const enrich: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (profile.name && !contact.name) enrich.name = profile.name
      if (profile.avatarUrl && !contact.avatar_url) enrich.avatar_url = profile.avatarUrl
      if (Object.keys(enrich).length > 1) {
        const { data: enriched } = await supabase
          .from('contacts')
          .update(enrich)
          .eq('id', contact.id)
          .eq('clerk_org_id', account.clerk_org_id)
          .select('*')
          .single()
        if (enriched) {
          Object.assign(contact, enriched)
        }
      }
    }
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
  // Two paths:
  //  - MESSAGES_SET fires once on initial sync with the full history. Here we
  //    pre-parse everything, upsert contacts and conversations in 2 bulk
  //    queries, then bulk-upsert messages in chunks. NO Evolution enrichment
  //    (that's what the manual `sync` button is for).
  //  - Any other batch event keeps the per-message path so enrichment runs
  //    in-band for the first message from a new contact.
  if (eventType !== 'MESSAGES_SET') {
    let persisted = 0
    for (const record of records) {
      const wrapped = { ...payload, event: eventType, data: record } as EvolutionWebhookPayload
      const parsed = parseEvolutionWebhook(wrapped)
      if (!parsed.message) continue
      try {
        await persistSingleMessage(wrapped, account, parsed)
        persisted += 1
      } catch {
        // skip and continue — single bad record should not abort the batch
      }
    }
    return { messages: persisted }
  }

  const supabase = getServerSupabase()
  // Keep raw record paired with parsed message — we need it later to
  // inspect key.remoteJidAlt during LID resolution.
  const parsedPairs: Array<{ message: ParsedEvolutionMessage; record: any; lidLearned?: string | null }> = []
  for (const record of records) {
    const wrapped = { ...payload, event: eventType, data: record } as EvolutionWebhookPayload
    const parsed = parseEvolutionWebhook(wrapped)
    if (parsed.message) parsedPairs.push({ message: parsed.message, record })
  }
  if (parsedPairs.length === 0) return { messages: 0 }

  // === LID → BR resolution (batch) ===
  // Collect every wa_id that isn't a real phone, look them up against
  // contacts.lid_alt in a single query, then rewrite each message's
  // identity (waId/phone) to the BR contact before any upsert. This is the
  // bulk equivalent of what persistSingleMessage does per-message and is
  // critical to avoid recreating LID-only contacts on every history replay.
  const lidsToResolve = Array.from(
    new Set(parsedPairs.filter((p) => !isRealPhone(p.message.waId)).map((p) => p.message.waId))
  )
  const lidMap = await resolveLidsToBr(account, lidsToResolve)

  // === Augment 1: key.remoteJidAlt → promote real phone ===
  // For any unresolved LID whose raw key carries a @s.whatsapp.net alt JID,
  // promote the real phone directly. This is the most reliable signal
  // because it comes straight from the Baileys payload.
  for (const pair of parsedPairs) {
    const m = pair.message
    if (isRealPhone(m.waId) || lidMap.has(m.waId)) continue
    const rawKey = (pair.record?.key || pair.record?.message?.key || {}) as Record<string, unknown>
    const rawAlt = String(rawKey.remoteJidAlt || '')
    if (rawAlt.endsWith('@s.whatsapp.net')) {
      const altPhone = rawAlt.replace('@s.whatsapp.net', '').replace(/\D/g, '')
      if (isRealPhone(altPhone)) {
        lidMap.set(m.waId, { waId: altPhone, phone: altPhone })
        pair.lidLearned = m.waId
      }
    }
  }

  // === Augment 2: push_name → BR contact ===
  // For LIDs still unresolved, try the message's pushName against existing
  // contacts.push_name / contacts.name. Only consider non-trivial names
  // (>= 3 chars, not Você, not all digits) and only match BR contacts.
  const stillUnresolved = parsedPairs.filter(
    (p) => !isRealPhone(p.message.waId) && !lidMap.has(p.message.waId)
  )
  const nameCandidates = new Set<string>()
  for (const pair of stillUnresolved) {
    const name = pair.message.name?.trim() || ''
    const nameDigits = name.replace(/\D/g, '')
    if (name.length < 3) continue
    if (name.toLowerCase() === 'voce' || name === 'Você') continue
    if (nameDigits === name.replace(/\s+/g, '') && nameDigits.length > 0) continue
    nameCandidates.add(name)
  }
  if (nameCandidates.size > 0) {
    const namesArr = Array.from(nameCandidates)
    const { data: nameRows } = await supabase
      .from('contacts')
      .select('wa_id, phone, name, push_name')
      .eq('clerk_org_id', account.clerk_org_id)
      .eq('whatsapp_account_id', account.id)
      .or(`push_name.in.(${namesArr.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(',')}),name.in.(${namesArr.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(',')})`)
    const byNameLower = new Map<string, { waId: string; phone: string }>()
    for (const row of nameRows || []) {
      if (!isRealPhone((row as any).wa_id as string)) continue
      const push = String((row as any).push_name || '').trim().toLowerCase()
      const nm = String((row as any).name || '').trim().toLowerCase()
      const entry = { waId: (row as any).wa_id as string, phone: ((row as any).phone as string) || ((row as any).wa_id as string) }
      if (push && !byNameLower.has(push)) byNameLower.set(push, entry)
      if (nm && !byNameLower.has(nm)) byNameLower.set(nm, entry)
    }
    for (const pair of stillUnresolved) {
      const lower = (pair.message.name || '').trim().toLowerCase()
      if (!lower) continue
      const hit = byNameLower.get(lower)
      if (hit) {
        lidMap.set(pair.message.waId, hit)
        pair.lidLearned = pair.message.waId
      }
    }
  }

  // Rewrite resolved LIDs in-place; drop outbound-only LID messages whose
  // contact does not exist yet (they would create pure-noise rows: no name,
  // no avatar, no counter-party identity). Inbound LIDs without a match are
  // kept — they represent real people we just haven't merged yet.
  const usable: ParsedEvolutionMessage[] = []
  const lidAltByWaId = new Map<string, string>()
  for (const pair of parsedPairs) {
    const m = pair.message
    if (isRealPhone(m.waId)) {
      usable.push(m)
      continue
    }
    const resolved = lidMap.get(m.waId)
    if (resolved) {
      // Remember the LID→BR mapping so we can persist it onto the BR
      // contact row after resolution (skips future lookups).
      if (pair.lidLearned) {
        lidAltByWaId.set(resolved.waId, pair.lidLearned)
      }
      m.waId = resolved.waId
      m.phone = resolved.phone
      usable.push(m)
      continue
    }
    if (m.direction === 'outbound') {
      // Skip outbound-only LID with no resolution.
      continue
    }
    usable.push(m)
  }
  if (usable.length === 0) return { messages: 0 }

  // Step 1: bulk upsert contacts (dedup by wa_id, keep first non-null name).
  const contactByWaId = new Map<string, { name: string | null; phone: string }>()
  for (const m of usable) {
    if (!contactByWaId.has(m.waId)) {
      contactByWaId.set(m.waId, { name: m.direction === 'inbound' ? m.name : null, phone: m.phone })
    }
  }
  const contactRows = Array.from(contactByWaId.entries()).map(([waId, info]) => ({
    clerk_org_id: account.clerk_org_id,
    whatsapp_account_id: account.id,
    wa_id: waId,
    phone: info.phone,
    ...(info.name ? { push_name: info.name } : {}),
    ...(lidAltByWaId.get(waId) ? { lid_alt: lidAltByWaId.get(waId) } : {}),
    updated_at: new Date().toISOString()
  }))

  const { data: upsertedContacts, error: contactErr } = await supabase
    .from('contacts')
    .upsert(contactRows, { onConflict: 'clerk_org_id,whatsapp_account_id,wa_id' })
    .select('id, wa_id')
  if (contactErr) throw contactErr

  const contactIdByWaId = new Map<string, string>()
  for (const row of upsertedContacts || []) {
    contactIdByWaId.set(row.wa_id as string, row.id as string)
  }

  // Step 2: bulk upsert conversations (one per contact).
  const conversationSeed = new Map<string, string>() // waId -> max sentAt
  for (const m of usable) {
    const prev = conversationSeed.get(m.waId)
    if (!prev || new Date(m.sentAt).getTime() > new Date(prev).getTime()) {
      conversationSeed.set(m.waId, m.sentAt)
    }
  }
  const conversationRows = Array.from(conversationSeed.entries()).flatMap(([waId, lastAt]) => {
    const cid = contactIdByWaId.get(waId)
    if (!cid) return []
    return [{
      clerk_org_id: account.clerk_org_id,
      whatsapp_account_id: account.id,
      contact_id: cid,
      status: 'open' as const,
      last_message_at: lastAt,
      updated_at: new Date().toISOString()
    }]
  })

  const { data: upsertedConvs, error: convErr } = await supabase
    .from('conversations')
    .upsert(conversationRows, { onConflict: 'clerk_org_id,whatsapp_account_id,contact_id' })
    .select('id, contact_id')
  if (convErr) throw convErr

  const convIdByContactId = new Map<string, string>()
  for (const row of upsertedConvs || []) {
    convIdByContactId.set(row.contact_id as string, row.id as string)
  }

  // Step 3: bulk upsert messages (chunked to avoid payload size limits).
  const messageRows = usable.flatMap((m) => {
    const cid = contactIdByWaId.get(m.waId)
    if (!cid) return []
    const convId = convIdByContactId.get(cid)
    if (!convId) return []
    return [{
      clerk_org_id: account.clerk_org_id,
      whatsapp_account_id: account.id,
      conversation_id: convId,
      contact_id: cid,
      wa_message_id: m.waMessageId,
      direction: m.direction,
      type: m.type,
      status: 'sent' as const,
      body: m.body,
      media_url: m.mediaUrl,
      sent_at: m.sentAt
    }]
  })

  const chunkSize = 500
  let persisted = 0
  for (let i = 0; i < messageRows.length; i += chunkSize) {
    const chunk = messageRows.slice(i, i + chunkSize)
    const { error: msgErr } = await supabase
      .from('messages')
      .upsert(chunk, { onConflict: 'clerk_org_id,whatsapp_account_id,wa_message_id', ignoreDuplicates: true })
    if (msgErr) {
      console.error('[webhook] bulk insert chunk failed', msgErr)
      continue
    }
    persisted += chunk.length
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

  // Counter-party deleted a message ("delete for everyone"). Soft-delete on
  // our side so the UI can render "Esta mensagem foi apagada" instead of
  // the original content.
  if (eventType === 'MESSAGES_DELETE') {
    const data = asRecord(record.data)
    const candidates = Array.isArray(data.keys) ? data.keys : Array.isArray(data) ? data : [data.key || data]
    const ids = candidates
      .map((c: any) => pickString(c?.id, c?.key?.id, c?.messageId))
      .filter(Boolean) as string[]
    if (ids.length > 0) {
      await supabase
        .from('messages')
        .update({ deleted_at: new Date().toISOString(), body: null, media_url: null })
        .eq('clerk_org_id', account.clerk_org_id)
        .eq('whatsapp_account_id', account.id)
        .in('wa_message_id', ids)
    }
    return { ok: true, account_id: account.id, event_type: eventType, deleted: ids.length }
  }

  // Counter-party cleared a chat. Mark the conversation as closed; we keep
  // the messages so the user can audit history.
  if (eventType === 'CHATS_DELETE') {
    const data = asRecord(record.data)
    const list = Array.isArray(data) ? data : Array.isArray(data.chats) ? data.chats : [data]
    const jids = list
      .map((item: any) => pickString(item?.id, item?.remoteJid, item?.jid, item))
      .map((j: string | null) => (j ? j.replace(/@.+$/, '').replace(/\D/g, '') : ''))
      .filter((p: string) => p.length >= 5)
    if (jids.length > 0) {
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id')
        .eq('clerk_org_id', account.clerk_org_id)
        .eq('whatsapp_account_id', account.id)
        .in('wa_id', jids)
      const contactIds = (contacts || []).map((c: any) => c.id)
      if (contactIds.length > 0) {
        await supabase
          .from('conversations')
          .update({ status: 'closed', updated_at: new Date().toISOString() })
          .eq('clerk_org_id', account.clerk_org_id)
          .eq('whatsapp_account_id', account.id)
          .in('contact_id', contactIds)
      }
    }
    return { ok: true, account_id: account.id, event_type: eventType, closed: jids.length }
  }

  // Outbound delivery / read receipt updates. We just bump status to 'sent'
  // (reconciles any local optimistic 'pending' rows) and log the event.
  if (eventType === 'MESSAGES_UPDATE') {
    const data = asRecord(record.data)
    const candidates = Array.isArray(data) ? data : Array.isArray(data.updates) ? data.updates : [data]
    let updated = 0
    for (const c of candidates) {
      const wid = pickString(c?.key?.id, c?.id, c?.messageId)
      if (!wid) continue
      const { error } = await supabase
        .from('messages')
        .update({ status: 'sent' })
        .eq('clerk_org_id', account.clerk_org_id)
        .eq('whatsapp_account_id', account.id)
        .eq('wa_message_id', wid)
      if (!error) updated += 1
    }
    return { ok: true, account_id: account.id, event_type: eventType, updated }
  }

  // PRESENCE_UPDATE → ephemeral typing/recording broadcast via Supabase
  // Realtime. We never persist this; the UI listens to the broadcast
  // channel and shows "está digitando..." for a few seconds.
  if (eventType === 'PRESENCE_UPDATE') {
    try {
      const data = asRecord(record.data)
      const targetJid = pickString(data.id)
      if (!targetJid || targetJid.includes('@g.us')) {
        return { ok: true, account_id: account.id, event_type: eventType, skipped: 'group-or-no-jid' }
      }
      const presences = asRecord(data.presences)
      const presenceEntry = asRecord(presences[targetJid])
      const state = pickString(presenceEntry.lastKnownPresence)
      if (!state) return { ok: true, account_id: account.id, event_type: eventType, skipped: 'no-state' }

      const phone = targetJid.replace(/@.+$/, '').replace(/\D/g, '')
      let resolvedWaId = phone
      // Try to resolve LID -> real BR contact
      const { data: lookup } = await supabase
        .from('contacts')
        .select('wa_id')
        .eq('clerk_org_id', (account as any).clerk_org_id)
        .eq('whatsapp_account_id', (account as any).id)
        .or(`wa_id.eq.${phone},lid_alt.eq.${phone}`)
        .limit(1)
        .maybeSingle()
      if (lookup?.wa_id) resolvedWaId = lookup.wa_id as string

      await supabase
        .channel(`presence:${(account as any).id}:${resolvedWaId}`)
        .send({
          type: 'broadcast',
          event: 'typing',
          payload: { wa_id: resolvedWaId, state, at: Date.now() }
        })
        .catch(() => null)

      return { ok: true, account_id: (account as any).id, event_type: eventType, wa_id: resolvedWaId, state }
    } catch {
      return { ok: true, account_id: (account as any).id, event_type: eventType, skipped: 'presence-error' }
    }
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
