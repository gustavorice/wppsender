export type OrgRole = 'org:owner' | 'org:admin' | 'org:agent' | 'org:member'

export type WhatsAppAccountStatus = 'connected' | 'pending' | 'disconnected' | 'error'

export interface WhatsAppAccount {
  id: string
  clerk_org_id: string
  instance_name: string
  display_name: string | null
  phone_number: string | null
  status: WhatsAppAccountStatus
  qr_code: string | null
  created_by_user_id: string | null
  last_connected_at: string | null
  created_at: string
  updated_at: string
}

export interface Contact {
  id: string
  clerk_org_id: string
  whatsapp_account_id: string
  wa_id: string
  name: string | null
  phone: string | null
  avatar_url: string | null
  tags: string[] | null
  created_at: string
  updated_at: string
}

export type ConversationStatus = 'open' | 'pending' | 'closed'

export interface Conversation {
  id: string
  clerk_org_id: string
  whatsapp_account_id: string
  contact_id: string
  status: ConversationStatus
  assigned_to_user_id: string | null
  last_message_at: string | null
  created_at: string
  updated_at: string
  contact?: Contact | null
  whatsapp_account?: Pick<WhatsAppAccount, 'id' | 'display_name' | 'phone_number' | 'status'> | null
  last_message?: Message | null
}

export type MessageDirection = 'inbound' | 'outbound'
export type MessageType = 'text' | 'image' | 'audio' | 'video' | 'document' | 'unknown'

export interface Message {
  id: string
  clerk_org_id: string
  whatsapp_account_id: string
  conversation_id: string
  contact_id: string
  wa_message_id: string | null
  direction: MessageDirection
  type: MessageType
  body: string | null
  media_url: string | null
  raw_payload: Record<string, unknown> | null
  sent_at: string | null
  created_at: string
}

export interface MessageEvent {
  id: string
  clerk_org_id: string
  message_id: string | null
  event_type: string
  raw_payload: Record<string, unknown> | null
  created_at: string
}

export interface EvolutionWebhookPayload {
  event?: string
  instance?: string | { instanceName?: string; state?: string; status?: string }
  instanceName?: string
  data?: unknown
  [key: string]: unknown
}

export interface ApiListResponse<T> {
  data: T[]
}

export interface ApiItemResponse<T> {
  data: T
}
