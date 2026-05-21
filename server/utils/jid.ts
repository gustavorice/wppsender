// Centralized WhatsApp JID parsing. A real JID is "<phone>@<server>" where
// server is one of:
//   - s.whatsapp.net   real phone (consumer accounts, agenda contacts)
//   - lid              WhatsApp Business virtual identifier (no real phone)
//   - g.us             group
//   - broadcast        broadcast list
//   - newsletter, bot  internal Meta endpoints
//
// Evolution v2.3 sometimes emits its own DB primary key (a CUID like
// "cmpd63ciq00jus54cmhnstzwt") in fields that should hold a JID. Anything
// without "@" is rejected outright.

export interface ParsedJid {
  raw: string
  id: string
  server: string
  isPhone: boolean
  isLid: boolean
  isGroup: boolean
  isBroadcast: boolean
  isInternal: boolean
}

export function parseJid(rawJid: string | null | undefined): ParsedJid | null {
  if (!rawJid) return null
  const trimmed = String(rawJid).trim()
  if (!trimmed || !trimmed.includes('@')) return null

  const idx = trimmed.lastIndexOf('@')
  const id = trimmed.slice(0, idx)
  const server = trimmed.slice(idx + 1).toLowerCase()

  return {
    raw: trimmed,
    id,
    server,
    isPhone: server === 's.whatsapp.net',
    isLid: server === 'lid',
    isGroup: server === 'g.us',
    isBroadcast: server === 'broadcast' || trimmed === 'status@broadcast',
    isInternal: server === 'newsletter' || server === 'bot'
  }
}

// True when JID is something we actually want to store as a contact /
// conversation / message. Rejects groups, broadcasts, internal addresses,
// and LIDs (LIDs ride along as `contacts.lid_alt` of a real phone instead).
export function isAcceptableJid(rawJid: string | null | undefined): boolean {
  const p = parseJid(rawJid)
  if (!p) return false
  if (p.isGroup || p.isBroadcast || p.isInternal) return false
  if (p.isLid) return false
  return true
}

// Final safety net for the digits we extract from a JID. 10-13 covers the
// vast majority of mobile numbering plans we encounter (BR 12-13, US 11,
// MX 12-13, PT 13...) and rejects the short fragments LIDs and CUIDs make.
export function isAcceptablePhone(phone: string | null | undefined): boolean {
  if (!phone) return false
  return phone.length >= 10 && phone.length <= 13
}

export function phoneFromJid(rawJid: string | null | undefined): string {
  const p = parseJid(rawJid)
  if (!p) return ''
  return p.id.replace(/\D/g, '')
}

// Heuristic for "this looks like a real phone number, not a LID identifier".
// Covers BR (12-13 digits starting with 55), US (11 digits starting with 1),
// and a curated list of common country codes (2 or 3 digit prefixes) for
// 10-13 digit numbers. Anything that doesn't match is treated as a LID-like
// opaque identifier and routed through the LID→BR resolution path.
export function isRealPhone(waId: string | null | undefined): boolean {
  if (!waId) return false
  if (waId.startsWith('55') && (waId.length === 12 || waId.length === 13)) return true
  if (waId.startsWith('1') && waId.length === 11) return true
  if (waId.length >= 10 && waId.length <= 13) {
    const cc2 = waId.slice(0, 2)
    const cc3 = waId.slice(0, 3)
    const known = new Set(['44', '49', '33', '34', '39', '31', '52', '54', '57', '58', '56', '51', '53', '61', '64', '82', '81', '86', '351', '353', '358'])
    return known.has(cc2) || known.has(cc3)
  }
  return false
}
