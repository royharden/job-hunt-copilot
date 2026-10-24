-- Job Hunt Copilot. Private per-user rows. No seed data.
-- Quota increments only while the day's count is under the cap.

create table public.facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in (
    'employer', 'title', 'skill', 'tool', 'metric', 'date',
    'education', 'project', 'accomplishment', 'eligibility'
  )),
  surface text not null check (char_length(surface) between 2 and 200),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table public.postings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('job', 'scholarship', 'fellowship')),
  title text not null check (char_length(title) between 1 and 200),
  organization text not null check (char_length(organization) between 1 and 200),
  body text not null check (char_length(body) between 1 and 20000),
  created_at timestamptz not null default now()
);

create table public.requirement_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  posting_id uuid not null references public.postings (id) on delete cascade,
  ordinal integer not null check (ordinal >= 0 and ordinal < 40),
  body text not null check (char_length(body) between 1 and 240),
  label text not null check (label in ('exact', 'lexical', 'gap')),
  support_fact_ids text[] not null default '{}',
  reason text not null check (char_length(reason) between 1 and 500),
  unique (posting_id, ordinal)
);

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  posting_id uuid not null references public.postings (id) on delete cascade,
  source text not null check (source in ('local_restatement', 'model')),
  model text,
  bullets jsonb not null,
  cover jsonb not null,
  gate_report jsonb not null,
  approvable boolean not null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (approved_at is null or approvable)
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  posting_id uuid not null unique references public.postings (id) on delete cascade,
  draft_id uuid references public.drafts (id) on delete set null,
  board_status text not null default 'draft' check (board_status in (
    'draft', 'approved', 'applied', 'interview', 'offer', 'rejected', 'withdrawn'
  )),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.replies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 20000),
  predicted_label text not null check (predicted_label in (
    'rejected', 'offer', 'interview', 'acknowledgement', 'not_applicable', 'unknown'
  )),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  needs_review boolean not null,
  confirmed_label text check (confirmed_label in (
    'rejected', 'offer', 'interview', 'acknowledgement', 'not_applicable', 'unknown'
  )),
  created_at timestamptz not null default now()
);

create table public.draft_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  calls integer not null default 0 check (calls >= 0 and calls <= 20),
  primary key (user_id, day)
);

create index facts_user_idx on public.facts (user_id, created_at desc);
create index postings_user_idx on public.postings (user_id, created_at desc);
create index drafts_posting_idx on public.drafts (posting_id, created_at desc);
create index applications_user_idx on public.applications (user_id, board_status);
create index replies_application_idx on public.replies (application_id, created_at desc);

alter table public.facts enable row level security;
alter table public.postings enable row level security;
alter table public.requirement_matches enable row level security;
alter table public.drafts enable row level security;
alter table public.applications enable row level security;
alter table public.replies enable row level security;
alter table public.draft_usage enable row level security;

revoke all on public.facts from anon;
revoke all on public.postings from anon;
revoke all on public.requirement_matches from anon;
revoke all on public.drafts from anon;
revoke all on public.applications from anon;
revoke all on public.replies from anon;
revoke all on public.draft_usage from anon, authenticated;

grant select, insert, update, delete on public.facts to authenticated;
grant select, insert, update, delete on public.postings to authenticated;
grant select, insert, update, delete on public.requirement_matches to authenticated;
grant select, insert, update, delete on public.drafts to authenticated;
grant select, insert, update, delete on public.applications to authenticated;
grant select, insert, update, delete on public.replies to authenticated;
grant select on public.draft_usage to authenticated;

create policy facts_all on public.facts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy postings_all on public.postings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy matches_all on public.requirement_matches for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy drafts_all on public.drafts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy applications_all on public.applications for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy replies_all on public.replies for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy draft_usage_select on public.draft_usage for select to authenticated
  using (user_id = auth.uid());

create or replace function public.reserve_draft_call(p_limit integer default 20)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cap integer := 20;
  used integer;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_limit is not null and p_limit >= 1 and p_limit < cap then
    cap := p_limit;
  end if;

  insert into public.draft_usage (user_id, day, calls)
  values (uid, (timezone('utc', now()))::date, 1)
  on conflict (user_id, day)
  do update set calls = draft_usage.calls + 1
  where draft_usage.calls < cap
  returning calls into used;

  if used is null then
    return -1;
  end if;
  return used;
end;
$$;

revoke all on function public.reserve_draft_call(integer) from public;
grant execute on function public.reserve_draft_call(integer) to authenticated;
