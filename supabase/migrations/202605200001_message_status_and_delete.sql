-- Track delivery status of outbound messages (optimistic UI reconciliation)
-- and let inbound MESSAGES_DELETE webhook flag messages as deleted-by-sender.
--
-- status flow:
--   pending  → local optimistic send (UI shows greyed/clock)
--   sent     → confirmed by Evolution send response or webhook echo
--   failed   → Evolution returned an error
--
-- deleted_at is set when the counter-party deletes the message ("delete for
-- everyone"). We never hard-delete so the UI can show a "Esta mensagem foi
-- apagada" placeholder.

alter table public.messages
  add column if not exists status text default 'sent',
  add column if not exists deleted_at timestamp with time zone;

alter table public.messages
  drop constraint if exists messages_status_check;

alter table public.messages
  add constraint messages_status_check
  check (status in ('pending', 'sent', 'failed'));

create index if not exists messages_tenant_status_idx
  on public.messages(clerk_org_id, status)
  where status = 'pending';
