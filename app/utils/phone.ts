// A wa_id is a "LID" — WhatsApp Business virtual identifier — when it does
// not match a real international phone pattern. We use country code prefix
// + length as the heuristic since LIDs have neither.
export function isLidWaId(waId?: string | null): boolean {
  if (!waId) return false
  const digits = waId.replace(/\D/g, '')
  if (!digits) return true
  // Brazil
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return false
  // US/Canada
  if (digits.startsWith('1') && digits.length === 11) return false
  // Other common: 10-13 digits + plausible country code
  if (digits.length >= 10 && digits.length <= 13) {
    const cc2 = digits.slice(0, 2)
    const cc3 = digits.slice(0, 3)
    // Heuristic: accept a short list of country codes we expect to see
    const valid2 = ['44', '49', '33', '34', '39', '31', '52', '54', '57', '58', '56', '51', '53', '61', '64', '82', '81', '86']
    const valid3 = ['351', '353', '358']
    if (valid2.includes(cc2) || valid3.includes(cc3)) return false
  }
  return true
}

export function formatPhone(raw?: string | null): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')

  // Brazilian E.164: 55 (cc) + DDD (2) + 8 or 9 digit local
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    const ddd = digits.slice(2, 4)
    const rest = digits.slice(4)
    const mid = rest.slice(0, rest.length - 4)
    const tail = rest.slice(-4)
    return `+55 (${ddd}) ${mid}-${tail}`
  }

  // US/Canada: 1 + 10 digits
  if (digits.startsWith('1') && digits.length === 11) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }

  // LID or unknown — return empty so the UI shows a placeholder instead
  // of garbage like "+213283915231476" pretending to be a phone number.
  if (isLidWaId(raw)) return ''

  // Generic E.164 fallback for legitimate international numbers
  if (digits.length >= 10 && digits.length <= 13) {
    return `+${digits}`
  }

  return raw
}

export function phoneLabel(raw?: string | null, fallback = 'WhatsApp'): string {
  const formatted = formatPhone(raw)
  return formatted || fallback
}

// Single source of truth for what to show as a contact's "name" in the UI.
// Hierarchy: real name (agenda) > pushName (set by the person on WhatsApp)
// > formatted phone > raw phone (only if it's not a LID, which has no real
// meaning). Always returns a non-empty string when a contact exists.
export function contactDisplayName(c?: {
  name?: string | null
  push_name?: string | null
  phone?: string | null
  wa_id?: string | null
} | null): string {
  if (!c) return 'Contato'
  const name = c.name?.trim()
  if (name) return name
  const push = c.push_name?.trim()
  if (push) return push
  const formatted = formatPhone(c.phone || c.wa_id)
  if (formatted) return formatted
  return 'Contato'
}

// Phone shown under the name. Returns empty string when no real phone is
// available (e.g. pure LID contact) so the UI can hide that line entirely
// instead of showing a misleading number.
export function contactPhoneLabel(c?: {
  phone?: string | null
  wa_id?: string | null
  name?: string | null
} | null): string {
  if (!c) return ''
  const formatted = formatPhone(c.phone || c.wa_id)
  if (formatted) return formatted
  return ''
}
