import type { Contact, Conversation, Message, MessageEvent, WhatsAppAccount } from './entities'

export interface Database {
  public: {
    Tables: {
      whatsapp_accounts: {
        Row: WhatsAppAccount & Record<string, unknown>
        Insert: Partial<WhatsAppAccount> & Pick<WhatsAppAccount, 'clerk_org_id' | 'instance_name'> & Record<string, unknown>
        Update: Partial<WhatsAppAccount> & Record<string, unknown>
        Relationships: []
      }
      contacts: {
        Row: Contact & Record<string, unknown>
        Insert: Partial<Contact> & Pick<Contact, 'clerk_org_id' | 'whatsapp_account_id' | 'wa_id'> & Record<string, unknown>
        Update: Partial<Contact> & Record<string, unknown>
        Relationships: []
      }
      conversations: {
        Row: Conversation & Record<string, unknown>
        Insert: Partial<Conversation> & Pick<Conversation, 'clerk_org_id' | 'whatsapp_account_id' | 'contact_id'> & Record<string, unknown>
        Update: Partial<Conversation> & Record<string, unknown>
        Relationships: []
      }
      messages: {
        Row: Message & Record<string, unknown>
        Insert: Partial<Message> & Pick<Message, 'clerk_org_id' | 'whatsapp_account_id' | 'conversation_id' | 'contact_id' | 'direction'> & Record<string, unknown>
        Update: Partial<Message> & Record<string, unknown>
        Relationships: []
      }
      message_events: {
        Row: MessageEvent & Record<string, unknown>
        Insert: Partial<MessageEvent> & Pick<MessageEvent, 'clerk_org_id' | 'event_type'> & Record<string, unknown>
        Update: Partial<MessageEvent> & Record<string, unknown>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
