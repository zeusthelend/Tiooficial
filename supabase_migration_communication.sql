-- Additive migration: chat and WebRTC signaling. Does not modify or delete existing tables/data.
create table if not exists public.sh_conversations (
  id uuid primary key default gen_random_uuid(),
  participant_ids uuid[] not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  constraint sh_conversations_min_participants check (cardinality(participant_ids) >= 2)
);
create index if not exists sh_conversations_participants_gin on public.sh_conversations using gin (participant_ids);
create table if not exists public.sh_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.sh_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists sh_messages_conversation_created on public.sh_messages(conversation_id, created_at);
create table if not exists public.sh_call_signals (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.sh_conversations(id) on delete cascade,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  signal_type text not null check (signal_type in ('offer','answer','ice','hangup','decline','busy')),
  payload jsonb,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);
create index if not exists sh_call_signals_inbox on public.sh_call_signals(to_user, consumed_at, created_at);
alter table public.sh_conversations enable row level security;
alter table public.sh_messages enable row level security;
alter table public.sh_call_signals enable row level security;
drop policy if exists sh_conversations_participant_select on public.sh_conversations;
create policy sh_conversations_participant_select on public.sh_conversations for select to authenticated using (auth.uid() = any(participant_ids));
drop policy if exists sh_conversations_participant_insert on public.sh_conversations;
create policy sh_conversations_participant_insert on public.sh_conversations for insert to authenticated with check (auth.uid() = created_by and auth.uid() = any(participant_ids));
drop policy if exists sh_messages_participant_select on public.sh_messages;
create policy sh_messages_participant_select on public.sh_messages for select to authenticated using (exists (select 1 from public.sh_conversations c where c.id = conversation_id and auth.uid() = any(c.participant_ids)));
drop policy if exists sh_messages_participant_insert on public.sh_messages;
create policy sh_messages_participant_insert on public.sh_messages for insert to authenticated with check (auth.uid() = sender_id and exists (select 1 from public.sh_conversations c where c.id = conversation_id and auth.uid() = any(c.participant_ids)));
drop policy if exists sh_call_signals_participant_select on public.sh_call_signals;
create policy sh_call_signals_participant_select on public.sh_call_signals for select to authenticated using (auth.uid() = to_user or auth.uid() = from_user);
drop policy if exists sh_call_signals_sender_insert on public.sh_call_signals;
create policy sh_call_signals_sender_insert on public.sh_call_signals for insert to authenticated with check (auth.uid() = from_user and exists (select 1 from public.sh_conversations c where c.id = conversation_id and auth.uid() = any(c.participant_ids) and to_user = any(c.participant_ids)));
drop policy if exists sh_call_signals_recipient_update on public.sh_call_signals;
create policy sh_call_signals_recipient_update on public.sh_call_signals for update to authenticated using (auth.uid() = to_user) with check (auth.uid() = to_user);
