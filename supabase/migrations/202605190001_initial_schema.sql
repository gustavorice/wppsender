create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.whatsapp_accounts (
  id uuid primary key default gen_random_uuid(),
  clerk_org_id text not null,
  instance_name text not null unique,
  display_name text,
  phone_number text,
  status text not null default 'disconnected',
  qr_code text,
  created_by_user_id text,
  last_connected_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint whatsapp_accounts_status_check check (status in ('connected', 'pending', 'disconnected', 'error'))
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  clerk_org_id text not null,
  whatsapp_account_id uuid not null references public.whatsapp_accounts(id) on delete cascade,
  wa_id text not null,
  name text,
  phone text,
  avatar_url text,
  tags text[] default '{}',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(clerk_org_id, whatsapp_account_id, wa_id)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  clerk_org_id text not null,
  whatsapp_account_id uuid not null references public.whatsapp_accounts(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  status text default 'open',
  assigned_to_user_id text,
  last_message_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint conversations_status_check check (status in ('open', 'pending', 'closed')),
  unique(clerk_org_id, whatsapp_account_id, contact_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  clerk_org_id text not null,
  whatsapp_account_id uuid not null references public.whatsapp_accounts(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  wa_message_id text,
  direction text not null,
  type text default 'text',
  body text,
  media_url text,
  raw_payload jsonb,
  sent_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  constraint messages_direction_check check (direction in ('inbound', 'outbound')),
  constraint messages_type_check check (type in ('text', 'image', 'audio', 'video', 'document', 'unknown')),
  unique(clerk_org_id, whatsapp_account_id, wa_message_id)
);

create table if not exists public.message_events (
  id uuid primary key default gen_random_uuid(),
  clerk_org_id text not null,
  message_id uuid references public.messages(id) on delete set null,
  event_type text not null,
  raw_payload jsonb,
  created_at timestamp with time zone default now()
);

create index if not exists messages_tenant_conversation_created_idx
  on public.messages(clerk_org_id, conversation_id, created_at desc);

create index if not exists conversations_tenant_last_message_idx
  on public.conversations(clerk_org_id, last_message_at desc);

create index if not exists contacts_tenant_phone_idx
  on public.contacts(clerk_org_id, phone);

create index if not exists whatsapp_accounts_tenant_status_idx
  on public.whatsapp_accounts(clerk_org_id, status);

drop trigger if exists whatsapp_accounts_set_updated_at on public.whatsapp_accounts;
create trigger whatsapp_accounts_set_updated_at
before update on public.whatsapp_accounts
for each row execute function public.set_updated_at();

drop trigger if exists contacts_set_updated_at on public.contacts;
create trigger contacts_set_updated_at
before update on public.contacts
for each row execute function public.set_updated_at();

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
before update on public.conversations
for each row execute function public.set_updated_at();

create or replace function public.clerk_org_id_from_jwt()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(auth.jwt() ->> 'org_id', ''),
    nullif(auth.jwt() -> 'o' ->> 'id', '')
  );
$$;

alter table public.whatsapp_accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_events enable row level security;

drop policy if exists "tenant select whatsapp accounts" on public.whatsapp_accounts;
create policy "tenant select whatsapp accounts"
on public.whatsapp_accounts for select
using (clerk_org_id = public.clerk_org_id_from_jwt());

drop policy if exists "tenant select contacts" on public.contacts;
create policy "tenant select contacts"
on public.contacts for select
using (clerk_org_id = public.clerk_org_id_from_jwt());

drop policy if exists "tenant select conversations" on public.conversations;
create policy "tenant select conversations"
on public.conversations for select
using (clerk_org_id = public.clerk_org_id_from_jwt());

drop policy if exists "tenant select messages" on public.messages;
create policy "tenant select messages"
on public.messages for select
using (clerk_org_id = public.clerk_org_id_from_jwt());

drop policy if exists "tenant select message events" on public.message_events;
create policy "tenant select message events"
on public.message_events for select
using (clerk_org_id = public.clerk_org_id_from_jwt());

do $$
begin
  alter publication supabase_realtime add table public.whatsapp_accounts;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.conversations;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;
