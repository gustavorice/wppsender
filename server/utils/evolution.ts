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
      webhook: config.webhookUrl
        ? {
            url: config.webhookUrl,
            enabled: true,
            byEvents: false,
            base64: true,
            events: ['APPLICATION_STARTUP', 'QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'SEND_MESSAGE']
          }
        : undefined
    }
  })
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
