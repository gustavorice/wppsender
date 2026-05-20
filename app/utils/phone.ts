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

  // Generic E.164 fallback
  if (digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`
  }

  return raw
}
