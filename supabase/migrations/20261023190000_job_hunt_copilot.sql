-- Job Hunt Copilot: private, owner-isolated schema (PLAN.md sections 4-5, 8).
-- Status: authored under Dirty Mode, NEVER APPLIED. The Grok-era draft of this file was never applied
-- anywhere (STATUS/HANDOFF 2026-10-23), so it was reconciled in place before first application; the old
-- text is preserved in git commit 74a1b0b. If this file has been applied anywhere, do not edit it: add a
-- forward migration instead.
--
-- Authority model:
--  * Every table has RLS, owner-only SELECT for `authenticated`, and no `anon` access.
--  * Clients may INSERT draft profile rows (sources, draft role/fact versions, skills, skill links) directly.
--  * Everything that carries authority goes through SECURITY DEFINER RPCs that check auth.uid() ownership,
--    pin search_path, and are granted only to `authenticated`: approvals of profile versions, postings,
--    requirement sets, evidence mappings, packet revisions, replies and stage changes.
--  * Rendering/grades and packet approvals (and the automatic saved/preparing -> approved move that
--    accompanies an approval) are written ONLY by commit_guard_result, which is granted to service_role alone and is called by the draft-approve edge
--    function after it verified the caller's JWT and recomputed the packet with the shared TS core.
--    (A user may still record any stage manually through apply_stage_change, as PLAN section 8 allows;
--    a stage label is not an approval and never authorizes export.)
--  * Child rows reference parents through composite (owner_id, id) keys so a foreign UUID never links.
--  * Character offsets in fact origins are JavaScript UTF-16 code units and are verified by the TS core;
--    SQL checks the exact source version, its sha256 and that the quote occurs in it.

create extension if not exists pgcrypto;

-- Declared IMMUTABLE so it can be used in generated columns (convert_to itself is only STABLE).
-- UTF-8 is the fixed target encoding, so the result depends only on the input text.
create or replace function public.utf8_sha256(p_text text) returns text
language sql immutable strict parallel safe set search_path = public, pg_catalog as $$
  select encode(sha256(convert_to(p_text, 'UTF8')), 'hex')
$$;

-- ---------------------------------------------------------------- owner state (profile revision counter)
create table public.owner_state (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  profile_revision bigint not null default 0
);

create or replace function public.bump_profile_revision() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid := coalesce((case when tg_op = 'DELETE' then old.owner_id else new.owner_id end), auth.uid());
begin
  insert into public.owner_state (owner_id, profile_revision) values (v_owner, 1)
  on conflict (owner_id) do update set profile_revision = owner_state.profile_revision + 1;
  return null;
end;
$$;
revoke all on function public.bump_profile_revision() from public, anon, authenticated;

-- ---------------------------------------------------------------- profile
create table public.source_versions (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  document_id uuid not null,
  version_id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) between 1 and 30000),
  sha256 text generated always as (public.utf8_sha256(body)) stored,
  created_at timestamptz not null default now(),
  unique (owner_id, version_id)
);

create table public.role_versions (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role_id uuid not null,
  version_id uuid primary key default gen_random_uuid(),
  employer text not null check (char_length(employer) between 1 and 200),
  title text not null check (char_length(title) between 1 and 200),
  start_month text not null check (start_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  end_month text check (end_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  is_current boolean not null,
  as_of text not null check (as_of ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'draft' check (status in ('draft', 'approved', 'withdrawn')),
  approved_at timestamptz,
  decided_at timestamptz, -- approval or withdrawal time; orders "current version"
  created_at timestamptz not null default now(),
  unique (owner_id, version_id),
  check ((is_current and end_month is null) or (not is_current and end_month is not null and end_month >= start_month))
);

create table public.fact_versions (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  fact_id uuid not null,
  version_id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('accomplishment', 'responsibility', 'skill_usage', 'education', 'credential', 'project', 'preference', 'other')),
  body text not null check (char_length(body) between 1 and 500),
  role_id uuid,
  role_version_id uuid,
  project_label text check (project_label is null or char_length(project_label) between 1 and 80),
  status text not null default 'draft' check (status in ('draft', 'approved', 'withdrawn')),
  origin jsonb not null check (
    (origin ->> 'type' = 'source_span' and origin ? 'documentVersionId' and origin ? 'quote' and origin ? 'start' and origin ? 'end')
    or (origin ->> 'type' = 'user_attestation' and char_length(coalesce(origin ->> 'statement', '')) between 1 and 500)
  ),
  origin_document_version_id uuid,
  approved_at timestamptz,
  withdrawn_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, version_id),
  unique (owner_id, fact_id, version_id),
  foreign key (owner_id, role_version_id) references public.role_versions (owner_id, version_id),
  foreign key (owner_id, origin_document_version_id) references public.source_versions (owner_id, version_id),
  check ((role_id is null) = (role_version_id is null)),
  check ((origin ->> 'type' = 'source_span') = (origin_document_version_id is not null))
);

create table public.skills (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  skill_id uuid primary key default gen_random_uuid(),
  canonical text not null check (char_length(canonical) between 1 and 60),
  aliases jsonb not null default '[]'::jsonb check (jsonb_typeof(aliases) = 'array' and jsonb_array_length(aliases) <= 12),
  unique (owner_id, skill_id)
);

create table public.skill_evidence (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  skill_id uuid not null,
  fact_id uuid not null,
  fact_version_id uuid not null,
  usage jsonb not null default '[]'::jsonb check (jsonb_typeof(usage) = 'array'),
  attested_months integer check (attested_months is null or attested_months between 0 and 600),
  primary key (owner_id, skill_id, fact_id),
  foreign key (owner_id, skill_id) references public.skills (owner_id, skill_id) on delete cascade,
  foreign key (owner_id, fact_id, fact_version_id) references public.fact_versions (owner_id, fact_id, version_id)
);

create trigger source_versions_profile after insert or update or delete on public.source_versions for each row execute function public.bump_profile_revision();
create trigger role_versions_profile after insert or update or delete on public.role_versions for each row execute function public.bump_profile_revision();
create trigger fact_versions_profile after insert or update or delete on public.fact_versions for each row execute function public.bump_profile_revision();
create trigger skills_profile after insert or update or delete on public.skills for each row execute function public.bump_profile_revision();
create trigger skill_evidence_profile after insert or update or delete on public.skill_evidence for each row execute function public.bump_profile_revision();

-- ---------------------------------------------------------------- postings, requirements, evidence
create table public.posting_versions (
  owner_id uuid not null references auth.users (id) on delete cascade,
  posting_id uuid not null,
  version_id uuid primary key,
  organisation text not null check (char_length(organisation) between 1 and 200),
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) between 1 and 20000),
  sha256 text generated always as (public.utf8_sha256(body)) stored,
  url text check (url is null or char_length(url) <= 2000),
  created_at timestamptz not null default now(),
  unique (owner_id, version_id),
  unique (owner_id, posting_id, version_id)
);

create table public.applications (
  owner_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid primary key,
  posting_id uuid not null,
  stage text not null default 'saved' check (stage in ('saved', 'preparing', 'approved', 'applied', 'interview', 'offer', 'rejected', 'withdrawn')),
  revision integer not null default 0 check (revision >= 0),
  notes text not null default '' check (char_length(notes) <= 4000),
  selected_packet_id uuid,
  selected_packet_revision integer,
  updated_at timestamptz not null default now(),
  unique (owner_id, posting_id),
  unique (owner_id, application_id),
  unique (owner_id, application_id, posting_id)
);

create table public.requirement_sets (
  owner_id uuid not null references auth.users (id) on delete cascade,
  posting_version_id uuid not null,
  revision integer not null check (revision >= 1),
  requirements jsonb not null check (jsonb_typeof(requirements) = 'array' and jsonb_array_length(requirements) <= 80),
  created_at timestamptz not null default now(),
  primary key (posting_version_id, revision),
  unique (owner_id, posting_version_id, revision),
  foreign key (owner_id, posting_version_id) references public.posting_versions (owner_id, version_id)
);

create table public.evidence_mappings (
  owner_id uuid not null references auth.users (id) on delete cascade,
  posting_version_id uuid not null,
  revision integer not null check (revision >= 1),
  requirement_set_revision integer not null,
  evidence jsonb not null check (jsonb_typeof(evidence) = 'array'),
  created_at timestamptz not null default now(),
  primary key (posting_version_id, revision),
  foreign key (owner_id, posting_version_id, requirement_set_revision)
    references public.requirement_sets (owner_id, posting_version_id, revision)
);

-- Normalized confirmed links: the composite FK proves every confirmed fact version is the caller's own.
create table public.evidence_links (
  owner_id uuid not null references auth.users (id) on delete cascade,
  posting_version_id uuid not null,
  mapping_revision integer not null,
  requirement_id uuid not null,
  requirement_version_id uuid not null,
  tier text not null check (tier in ('direct', 'partial')),
  fact_version_id uuid not null,
  primary key (posting_version_id, mapping_revision, requirement_id, fact_version_id),
  foreign key (posting_version_id, mapping_revision) references public.evidence_mappings (posting_version_id, revision) on delete cascade,
  foreign key (owner_id, fact_version_id) references public.fact_versions (owner_id, version_id)
);

-- ---------------------------------------------------------------- packets and approvals
create table public.packet_revisions (
  owner_id uuid not null references auth.users (id) on delete cascade,
  packet_id uuid not null,
  revision integer not null check (revision >= 1),
  parent_revision integer,
  application_id uuid not null,
  posting_id uuid not null,
  posting_version_id uuid not null,
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 40),
  created_at timestamptz not null default now(),
  primary key (packet_id, revision),
  unique (owner_id, packet_id, revision),
  -- same owner, same application, and the posting version belongs to that application's posting
  foreign key (owner_id, application_id, posting_id) references public.applications (owner_id, application_id, posting_id),
  foreign key (owner_id, posting_id, posting_version_id) references public.posting_versions (owner_id, posting_id, version_id)
);

create table public.packet_line_facts (
  owner_id uuid not null,
  packet_id uuid not null,
  revision integer not null,
  line_id text not null,
  fact_version_id uuid not null,
  primary key (packet_id, revision, line_id),
  foreign key (owner_id, packet_id, revision) references public.packet_revisions (owner_id, packet_id, revision) on delete cascade,
  foreign key (owner_id, fact_version_id) references public.fact_versions (owner_id, version_id)
);

-- Written only by commit_guard_result (service role).
create table public.packet_renderings (
  owner_id uuid not null,
  packet_id uuid not null,
  revision integer not null,
  rendered_lines jsonb not null,
  rendered_sha256 text not null check (rendered_sha256 ~ '^[0-9a-f]{64}$'),
  guard_version text not null,
  template_version text not null,
  created_at timestamptz not null default now(),
  primary key (packet_id, revision),
  unique (owner_id, packet_id, revision),
  foreign key (owner_id, packet_id, revision) references public.packet_revisions (owner_id, packet_id, revision)
);

create table public.approvals (
  owner_id uuid not null,
  packet_id uuid not null,
  revision integer not null,
  rendered_sha256 text not null check (rendered_sha256 ~ '^[0-9a-f]{64}$'),
  binding_sha256 text not null check (binding_sha256 ~ '^[0-9a-f]{64}$'),
  binding jsonb not null,
  wording_attested boolean not null default false,
  request_id uuid not null,
  approved_at timestamptz not null default now(),
  primary key (packet_id, revision, binding_sha256),
  unique (owner_id, request_id),
  foreign key (owner_id, packet_id, revision) references public.packet_renderings (owner_id, packet_id, revision)
);

-- ---------------------------------------------------------------- replies and stage history
create table public.replies (
  owner_id uuid not null references auth.users (id) on delete cascade,
  reply_id uuid primary key,
  application_id uuid not null,
  body text not null check (char_length(body) between 1 and 20000),
  prediction jsonb not null, -- advisory rule evidence computed by the shared core; never authority
  chosen_label text check (chosen_label in ('rejection', 'interview', 'offer', 'acknowledgement', 'not_applicable', 'unknown')),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, reply_id),
  foreign key (owner_id, application_id) references public.applications (owner_id, application_id),
  check ((chosen_label is null) = (confirmed_at is null))
);

create table public.stage_events (
  owner_id uuid not null,
  event_id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  from_stage text not null,
  to_stage text not null,
  reply_id uuid,
  chosen_label text,
  request_id text not null check (char_length(request_id) between 1 and 120),
  revision integer not null,
  created_at timestamptz not null default now(),
  foreign key (owner_id, application_id) references public.applications (owner_id, application_id),
  foreign key (owner_id, reply_id) references public.replies (owner_id, reply_id)
);

-- Idempotency ledger for apply_stage_change and draft-approve.
create table public.request_ledger (
  owner_id uuid not null references auth.users (id) on delete cascade,
  request_id text not null check (char_length(request_id) between 1 and 120),
  operation text not null check (operation in ('apply_stage_change', 'draft_approve')),
  fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, request_id)
);

-- ---------------------------------------------------------------- RLS and grants
do $$
declare
  t text;
begin
  foreach t in array array[
    'owner_state', 'source_versions', 'role_versions', 'fact_versions', 'skills', 'skill_evidence',
    'posting_versions', 'applications', 'requirement_sets', 'evidence_mappings', 'evidence_links',
    'packet_revisions', 'packet_line_facts', 'packet_renderings', 'approvals', 'replies', 'stage_events', 'request_ledger'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid())', t || '_select', t);
  end loop;
end;
$$;

-- Direct client writes: draft-only profile rows. Approval/withdrawal is an RPC; approved rows never change.
grant insert (document_id, title, body) on public.source_versions to authenticated;
create policy source_versions_insert on public.source_versions for insert to authenticated with check (owner_id = auth.uid());

grant insert (role_id, employer, title, start_month, end_month, is_current, as_of) on public.role_versions to authenticated;
create policy role_versions_insert on public.role_versions for insert to authenticated
  with check (owner_id = auth.uid() and status = 'draft' and approved_at is null and decided_at is null);

grant insert (fact_id, kind, body, role_id, role_version_id, project_label, origin, origin_document_version_id) on public.fact_versions to authenticated;
create policy fact_versions_insert on public.fact_versions for insert to authenticated
  with check (owner_id = auth.uid() and status = 'draft' and approved_at is null and decided_at is null and withdrawn_at is null);

grant insert (skill_id, canonical, aliases), update (canonical, aliases), delete on public.skills to authenticated;
create policy skills_insert on public.skills for insert to authenticated with check (owner_id = auth.uid());
create policy skills_update on public.skills for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy skills_delete on public.skills for delete to authenticated using (owner_id = auth.uid());

-- UPDATE includes skill_id/fact_id because PostgREST upserts SET every supplied column; ownership stays
-- enforced by RLS and the composite (owner_id, ...) foreign keys.
grant insert (skill_id, fact_id, fact_version_id, usage, attested_months), update (skill_id, fact_id, fact_version_id, usage, attested_months), delete
  on public.skill_evidence to authenticated;
create policy skill_evidence_insert on public.skill_evidence for insert to authenticated with check (owner_id = auth.uid());
create policy skill_evidence_update on public.skill_evidence for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy skill_evidence_delete on public.skill_evidence for delete to authenticated using (owner_id = auth.uid());

-- ---------------------------------------------------------------- helpers (not callable by clients)
create or replace function public.require_uid() returns uuid
language plpgsql stable set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  return auth.uid();
end;
$$;

-- Current version = newest decided (approved or withdrawn) version; usable only when it is approved.
create or replace function public.current_fact_version(p_owner uuid, p_fact_id uuid) returns uuid
language sql stable set search_path = public, pg_temp as $$
  select case when v.status = 'approved' then v.version_id end
  from public.fact_versions v
  where v.owner_id = p_owner and v.fact_id = p_fact_id and v.status <> 'draft'
  order by v.decided_at desc, v.version_id desc
  limit 1
$$;

create or replace function public.current_role_version(p_owner uuid, p_role_id uuid) returns uuid
language sql stable set search_path = public, pg_temp as $$
  select case when v.status = 'approved' then v.version_id end
  from public.role_versions v
  where v.owner_id = p_owner and v.role_id = p_role_id and v.status <> 'draft'
  order by v.decided_at desc, v.version_id desc
  limit 1
$$;

create or replace function public.is_current_fact_version(p_owner uuid, p_version_id uuid) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select coalesce((
    select public.current_fact_version(p_owner, v.fact_id) = v.version_id
    from public.fact_versions v where v.owner_id = p_owner and v.version_id = p_version_id
  ), false)
$$;

revoke all on function public.require_uid() from public, anon, authenticated;
revoke all on function public.current_fact_version(uuid, uuid) from public, anon, authenticated;
revoke all on function public.current_role_version(uuid, uuid) from public, anon, authenticated;
revoke all on function public.is_current_fact_version(uuid, uuid) from public, anon, authenticated;

-- Validates a client-computed evidence array for one posting version and writes mapping + links.
-- Proposals are advisory; every CONFIRMED entry is checked: requirement exists in the given set revision,
-- is retained and reviewed, version matches, tier shape is valid, and every fact is the owner's current
-- approved version.
create or replace function public.write_mapping(
  p_owner uuid, p_posting_version_id uuid, p_set_revision integer, p_revision integer, p_evidence jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_set jsonb;
  v_item jsonb;
  v_req jsonb;
  v_conf jsonb;
  v_fact jsonb;
begin
  if jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) > 80 then
    raise exception 'invalid_input: evidence' using errcode = '22023';
  end if;
  select requirements into v_set from public.requirement_sets
    where owner_id = p_owner and posting_version_id = p_posting_version_id and revision = p_set_revision;
  if v_set is null then
    raise exception 'forbidden: requirement set' using errcode = '42501';
  end if;
  insert into public.evidence_mappings (owner_id, posting_version_id, revision, requirement_set_revision, evidence)
    values (p_owner, p_posting_version_id, p_revision, p_set_revision, p_evidence);
  for v_item in select * from jsonb_array_elements(p_evidence) loop
    v_conf := v_item -> 'confirmed';
    if v_conf is null or jsonb_typeof(v_conf) = 'null' then
      continue;
    end if;
    v_req := null;
    select r.value into v_req from jsonb_array_elements(v_set) as r(value) where r.value ->> 'requirementId' = v_item ->> 'requirementId';
    if v_req is null or (v_req ->> 'versionId') <> (v_item ->> 'requirementVersionId')
       or coalesce((v_req ->> 'removed')::boolean, true) or not coalesce((v_req ->> 'reviewed')::boolean, false) then
      raise exception 'invalid_input: confirmation needs a retained reviewed requirement' using errcode = '22023';
    end if;
    if v_conf ->> 'tier' = 'gap' then
      if jsonb_array_length(coalesce(v_conf -> 'facts', '[]'::jsonb)) <> 0 then
        raise exception 'invalid_input: a gap has no evidence' using errcode = '22023';
      end if;
      continue;
    end if;
    if v_conf ->> 'tier' not in ('direct', 'partial') or jsonb_array_length(coalesce(v_conf -> 'facts', '[]'::jsonb)) not between 1 and 8 then
      raise exception 'invalid_input: confirmation shape' using errcode = '22023';
    end if;
    for v_fact in select * from jsonb_array_elements(v_conf -> 'facts') loop
      if not public.is_current_fact_version(p_owner, (v_fact ->> 'versionId')::uuid) then
        raise exception 'stale: confirmed statement is not current' using errcode = '40001';
      end if;
      insert into public.evidence_links (owner_id, posting_version_id, mapping_revision, requirement_id, requirement_version_id, tier, fact_version_id)
        values (p_owner, p_posting_version_id, p_revision, (v_item ->> 'requirementId')::uuid,
                (v_item ->> 'requirementVersionId')::uuid, v_conf ->> 'tier', (v_fact ->> 'versionId')::uuid);
    end loop;
  end loop;
end;
$$;
revoke all on function public.write_mapping(uuid, uuid, integer, integer, jsonb) from public, anon, authenticated;

create or replace function public.insert_stage_event(
  p_owner uuid, p_app public.applications, p_to text, p_reply uuid, p_label text, p_request text
) returns public.applications
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_app public.applications;
begin
  update public.applications set stage = p_to, revision = revision + 1, updated_at = now()
    where owner_id = p_owner and application_id = p_app.application_id
    returning * into v_app;
  insert into public.stage_events (owner_id, application_id, from_stage, to_stage, reply_id, chosen_label, request_id, revision)
    values (p_owner, p_app.application_id, p_app.stage, p_to, p_reply, p_label, p_request, v_app.revision);
  return v_app;
end;
$$;
revoke all on function public.insert_stage_event(uuid, public.applications, text, uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- client RPCs (authenticated)
-- Decision timestamps use clock_timestamp(), not now() (transaction start), so an approval and a later
-- withdrawal in the same transaction are strictly ordered and "current version" never depends on UUID order.
create or replace function public.approve_fact_version(p_fact_id uuid, p_version_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid := public.require_uid();
  v_row public.fact_versions;
  v_doc public.source_versions;
begin
  select * into v_row from public.fact_versions
    where owner_id = v_owner and fact_id = p_fact_id and version_id = p_version_id for update;
  if v_row is null or v_row.status <> 'draft' then
    raise exception 'invalid_input: only a draft statement can be approved' using errcode = '22023';
  end if;
  if v_row.origin ->> 'type' = 'source_span' then
    select * into v_doc from public.source_versions where owner_id = v_owner and version_id = v_row.origin_document_version_id;
    if v_doc is null
       or v_row.origin_document_version_id::text is distinct from (v_row.origin ->> 'documentVersionId')
       or v_doc.sha256 is distinct from (v_row.origin ->> 'documentSha256')
       or coalesce(strpos(v_doc.body, v_row.origin ->> 'quote'), 0) = 0
       or btrim(regexp_replace(v_row.origin ->> 'quote', '\s+', ' ', 'g')) is distinct from v_row.body then
      raise exception 'invalid_input: source span does not match its source version' using errcode = '22023';
    end if;
  end if;
  update public.fact_versions set status = 'approved', approved_at = clock_timestamp(), decided_at = clock_timestamp()
    where version_id = p_version_id and owner_id = v_owner;
end;
$$;

create or replace function public.withdraw_fact(p_fact_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid := public.require_uid();
  v_current uuid := public.current_fact_version(v_owner, p_fact_id);
begin
  if v_current is null then
    raise exception 'invalid_input: no approved statement to withdraw' using errcode = '22023';
  end if;
  insert into public.fact_versions (owner_id, fact_id, kind, body, role_id, role_version_id, project_label, status, origin,
                                    origin_document_version_id, approved_at, withdrawn_at, decided_at)
  select owner_id, fact_id, kind, body, role_id, role_version_id, project_label, 'withdrawn', origin,
         origin_document_version_id, approved_at, clock_timestamp(), clock_timestamp()
  from public.fact_versions where version_id = v_current;
end;
$$;

create or replace function public.approve_role_version(p_role_id uuid, p_version_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid := public.require_uid();
begin
  update public.role_versions set status = 'approved', approved_at = clock_timestamp(), decided_at = clock_timestamp()
    where owner_id = v_owner and role_id = p_role_id and version_id = p_version_id and status = 'draft';
  if not found then
    raise exception 'invalid_input: only a draft role version can be approved' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.withdraw_role(p_role_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid := public.require_uid();
  v_current uuid := public.current_role_version(v_owner, p_role_id);
begin
  if v_current is null then
    raise exception 'invalid_input: no approved role to withdraw' using errcode = '22023';
  end if;
  insert into public.role_versions (owner_id, role_id, employer, title, start_month, end_month, is_current, as_of, status, approved_at, decided_at)
  select owner_id, role_id, employer, title, start_month, end_month, is_current, as_of, 'withdrawn', approved_at, clock_timestamp()
  from public.role_versions where version_id = v_current;
end;
$$;

-- Creates posting version, application, requirement set 1 and mapping 1 together.
create or replace function public.create_posting(
  p_posting_id uuid, p_version_id uuid, p_application_id uuid,
  p_organisation text, p_title text, p_body text, p_url text,
  p_requirements jsonb, p_evidence jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid := public.require_uid();
begin
  if jsonb_typeof(p_requirements) <> 'array' or jsonb_array_length(p_requirements) > 40 then
    raise exception 'invalid_input: requirements' using errcode = '22023';
  end if;
  insert into public.posting_versions (owner_id, posting_id, version_id, organisation, title, body, url)
    values (v_owner, p_posting_id, p_version_id, p_organisation, p_title, p_body, p_url);
  insert into public.applications (owner_id, application_id, posting_id) values (v_owner, p_application_id, p_posting_id);
  insert into public.requirement_sets (owner_id, posting_version_id, revision, requirements)
    values (v_owner, p_version_id, 1, p_requirements);
  perform public.write_mapping(v_owner, p_version_id, 1, 1, p_evidence);
end;
$$;

create or replace function public.save_requirements(
  p_posting_version_id uuid, p_expected_revision integer, p_requirements jsonb, p_evidence jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid := public.require_uid();
  v_latest integer;
  v_mapping integer;
begin
  perform 1 from public.posting_versions where owner_id = v_owner and version_id = p_posting_version_id for update;
  if not found then
    raise exception 'forbidden: posting' using errcode = '42501';
  end if;
  select max(revision) into v_latest from public.requirement_sets where owner_id = v_owner and posting_version_id = p_posting_version_id;
  if v_latest is distinct from p_expected_revision then
    raise exception 'stale: requirements changed' using errcode = '40001';
  end if;
  if jsonb_typeof(p_requirements) <> 'array' or jsonb_array_length(p_requirements) > 80 then
    raise exception 'invalid_input: requirements' using errcode = '22023';
  end if;
  insert into public.requirement_sets (owner_id, posting_version_id, revision, requirements)
    values (v_owner, p_posting_version_id, v_latest + 1, p_requirements);
  select max(revision) into v_mapping from public.evidence_mappings where owner_id = v_owner and posting_version_id = p_posting_version_id;
  perform public.write_mapping(v_owner, p_posting_version_id, v_latest + 1, v_mapping + 1, p_evidence);
end;
$$;

create or replace function public.save_mapping(p_posting_version_id uuid, p_expected_revision integer, p_evidence jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid := public.require_uid();
  v_mapping integer;
  v_set integer;
begin
  perform 1 from public.posting_versions where owner_id = v_owner and version_id = p_posting_version_id for update;
  if not found then
    raise exception 'forbidden: posting' using errcode = '42501';
  end if;
  select max(revision) into v_mapping from public.evidence_mappings where owner_id = v_owner and posting_version_id = p_posting_version_id;
  if v_mapping is distinct from p_expected_revision then
    raise exception 'stale: evidence changed' using errcode = '40001';
  end if;
  select max(revision) into v_set from public.requirement_sets where owner_id = v_owner and posting_version_id = p_posting_version_id;
  perform public.write_mapping(v_owner, p_posting_version_id, v_set, v_mapping + 1, p_evidence);
end;
$$;

-- Saves an untrusted packet proposal as a new revision. Never approves anything.
create or replace function public.save_packet_revision(
  p_application_id uuid, p_packet_id uuid, p_expected_revision integer, p_lines jsonb
) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid := public.require_uid();
  v_app public.applications;
  v_posting_version uuid;
  v_latest integer;
  v_line jsonb;
  v_ids text[] := '{}';
begin
  select * into v_app from public.applications where owner_id = v_owner and application_id = p_application_id for update;
  if v_app is null then
    raise exception 'forbidden: application' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 40 then
    raise exception 'invalid_input: lines' using errcode = '22023';
  end if;
  select max(revision) into v_latest from public.packet_revisions where packet_id = p_packet_id;
  if v_latest is not null and not exists (
    select 1 from public.packet_revisions where packet_id = p_packet_id and owner_id = v_owner and application_id = p_application_id
  ) then
    raise exception 'forbidden: packet' using errcode = '42501';
  end if;
  if v_latest is distinct from p_expected_revision then
    raise exception 'stale: packet changed' using errcode = '40001';
  end if;
  select version_id into v_posting_version from public.posting_versions
    where owner_id = v_owner and posting_id = v_app.posting_id order by created_at desc limit 1;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce(v_line ->> 'kind', '') not in ('fact', 'template')
       or char_length(coalesce(v_line ->> 'proposalText', '')) not between 1 and 500
       or char_length(coalesce(v_line ->> 'lineId', '')) not between 1 and 80
       or (v_line ->> 'lineId') = any (v_ids) then
      raise exception 'invalid_input: line' using errcode = '22023';
    end if;
    v_ids := v_ids || (v_line ->> 'lineId');
  end loop;
  insert into public.packet_revisions (owner_id, packet_id, revision, parent_revision, application_id, posting_id, posting_version_id, lines)
    values (v_owner, p_packet_id, coalesce(v_latest, 0) + 1, v_latest, p_application_id, v_app.posting_id, v_posting_version, p_lines);
  -- composite FK rejects foreign or phantom fact versions
  insert into public.packet_line_facts (owner_id, packet_id, revision, line_id, fact_version_id)
    select v_owner, p_packet_id, coalesce(v_latest, 0) + 1, l ->> 'lineId', (l -> 'fact' ->> 'versionId')::uuid
    from jsonb_array_elements(p_lines) l where l ->> 'kind' = 'fact';
  return coalesce(v_latest, 0) + 1;
end;
$$;

create or replace function public.add_reply(p_reply_id uuid, p_application_id uuid, p_body text, p_prediction jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid := public.require_uid();
begin
  if jsonb_typeof(p_prediction) <> 'object' then
    raise exception 'invalid_input: prediction' using errcode = '22023';
  end if;
  insert into public.replies (owner_id, reply_id, application_id, body, prediction)
    values (v_owner, p_reply_id, p_application_id, p_body, p_prediction);
end;
$$;

create or replace function public.save_notes(p_application_id uuid, p_notes text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid := public.require_uid();
begin
  update public.applications set notes = p_notes, updated_at = now() where owner_id = v_owner and application_id = p_application_id;
  if not found then
    raise exception 'forbidden: application' using errcode = '42501';
  end if;
end;
$$;

-- Mirror of board.ts stageAfterReply.
create or replace function public.stage_after_reply(p_current text, p_label text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case
    when p_current in ('withdrawn', 'rejected') then p_current
    when p_label = 'rejection' then 'rejected'
    when p_label = 'offer' then 'offer'
    when p_label = 'interview' then case when p_current = 'offer' then p_current else 'interview' end
    else p_current
  end
$$;

-- Mirror of board.ts applyStageChange: confirm reply + change stage + bump revision + append event, all in
-- one transaction, idempotent per request id, stale on an outdated expected revision.
create or replace function public.apply_stage_change(
  p_application_id uuid, p_expected_revision integer, p_to_stage text, p_reply_id uuid, p_chosen_label text, p_request_id text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid := public.require_uid();
  v_fingerprint text := encode(sha256(convert_to(jsonb_build_object(
    'operation', 'apply_stage_change', 'applicationId', p_application_id, 'expectedRevision', p_expected_revision,
    'toStage', p_to_stage, 'replyId', p_reply_id, 'chosenLabel', p_chosen_label)::text, 'UTF8')), 'hex');
  v_prior public.request_ledger;
  v_app public.applications;
  v_reply public.replies;
  v_result jsonb;
begin
  if p_expected_revision is null or p_request_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input', 'message', 'Expected revision and request id are required.');
  end if;
  -- Lock first, then consult the ledger, so concurrent identical retries see the stored result.
  select * into v_app from public.applications where owner_id = v_owner and application_id = p_application_id for update;
  select * into v_prior from public.request_ledger where owner_id = v_owner and request_id = p_request_id;
  if v_prior is not null then
    if v_prior.fingerprint = v_fingerprint then
      return v_prior.result;
    end if;
    return jsonb_build_object('ok', false, 'code', 'conflict', 'message', 'This request id was already used with different details.');
  end if;
  if p_to_stage is null or p_to_stage not in ('saved', 'preparing', 'approved', 'applied', 'interview', 'offer', 'rejected', 'withdrawn')
     or (p_chosen_label is not null and p_chosen_label not in ('rejection', 'interview', 'offer', 'acknowledgement', 'not_applicable', 'unknown')) then
    return jsonb_build_object('ok', false, 'code', 'invalid_input', 'message', 'Unknown stage or label.');
  end if;
  if v_app is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'Application not found.');
  end if;
  if v_app.revision <> p_expected_revision then
    return jsonb_build_object('ok', false, 'code', 'stale', 'message', 'The board changed since you looked. Refresh and confirm again.');
  end if;
  if p_reply_id is not null then
    select * into v_reply from public.replies where owner_id = v_owner and reply_id = p_reply_id for update;
    if v_reply is null or v_reply.application_id <> p_application_id then
      return jsonb_build_object('ok', false, 'code', 'invalid_input', 'message', 'Reply does not belong to this application.');
    end if;
    if v_reply.confirmed_at is not null then
      return jsonb_build_object('ok', false, 'code', 'stale', 'message', 'This reply was already confirmed.');
    end if;
    if p_chosen_label is null then
      return jsonb_build_object('ok', false, 'code', 'invalid_input', 'message', 'Choose a label to confirm the reply.');
    end if;
    if p_to_stage <> public.stage_after_reply(v_app.stage, p_chosen_label) then
      return jsonb_build_object('ok', false, 'code', 'invalid_input', 'message', 'Reply-driven moves must follow the stage rules. Change other stages manually.');
    end if;
    update public.replies set chosen_label = p_chosen_label, confirmed_at = now() where reply_id = p_reply_id;
  elsif p_chosen_label is not null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input', 'message', 'A label needs a reply.');
  end if;
  v_app := public.insert_stage_event(v_owner, v_app, p_to_stage, p_reply_id, p_chosen_label, p_request_id);
  v_result := jsonb_build_object('ok', true, 'revision', v_app.revision, 'stage', v_app.stage);
  insert into public.request_ledger (owner_id, request_id, operation, fingerprint, result)
    values (v_owner, p_request_id, 'apply_stage_change', v_fingerprint, v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------- service-only approval commit
-- Called by the draft-approve edge function with the service role AFTER it verified the caller's JWT and
-- ownership and recomputed the rendering and full binding with the shared TS core from rows it read.
-- This transaction locks the application and compares every current input it can see in SQL with the
-- tuple the handler used; any difference is a stale conflict and nothing is written.
create or replace function public.commit_guard_result(
  p_owner uuid,
  p_request_id uuid,
  p_packet_id uuid,
  p_revision integer,
  p_profile_revision bigint,
  p_binding jsonb,
  p_binding_sha256 text,
  p_rendered_sha256 text,
  p_rendered_lines jsonb,
  p_guard_version text,
  p_template_version text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_packet public.packet_revisions;
  v_app public.applications;
  v_prior public.request_ledger;
  v_fp text := p_packet_id::text || ':' || p_revision::text || ':' || p_binding_sha256;
  v_result jsonb;
  v_id text;
  v_profile_rev bigint;
begin
  select * into v_packet from public.packet_revisions where owner_id = p_owner and packet_id = p_packet_id and revision = p_revision;
  if v_packet is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  -- Lock the application before consulting the ledger so concurrent identical requests replay the stored
  -- result instead of colliding on the ledger key.
  select * into v_app from public.applications where owner_id = p_owner and application_id = v_packet.application_id for update;
  select * into v_prior from public.request_ledger where owner_id = p_owner and request_id = p_request_id::text;
  if v_prior is not null then
    if v_prior.fingerprint = v_fp then
      return v_prior.result;
    end if;
    return jsonb_build_object('ok', false, 'code', 'conflict');
  end if;
  -- Every binding key the commit compares must be present; a malformed binding never passes by NULL.
  if not (p_binding ?& array['packetId', 'packetRevision', 'applicationId', 'postingVersionId', 'requirementSetRevision',
                             'mappingRevision', 'factVersionIds', 'guardVersion', 'templateVersion', 'renderedSha256'])
     or jsonb_typeof(p_binding -> 'factVersionIds') <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if (p_binding ->> 'packetId') is distinct from p_packet_id::text
     or (p_binding ->> 'packetRevision') is distinct from p_revision::text then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  -- Any profile change (sources, roles, facts, skills, aliases, tenure links) since the handler read the
  -- profile bumps owner_state.profile_revision, so alias/tenure/source edits cannot race the approval.
  select profile_revision into v_profile_rev from public.owner_state where owner_id = p_owner for update;
  if coalesce(v_profile_rev, 0) <> p_profile_revision then
    return jsonb_build_object('ok', false, 'code', 'stale', 'detail', 'profile');
  end if;
  if (select max(revision) from public.packet_revisions where packet_id = p_packet_id) is distinct from p_revision then
    return jsonb_build_object('ok', false, 'code', 'stale', 'detail', 'packet');
  end if;
  if (select version_id from public.posting_versions where owner_id = p_owner and posting_id = v_app.posting_id order by created_at desc limit 1)
       is distinct from v_packet.posting_version_id
     or (p_binding ->> 'postingVersionId')::uuid is distinct from v_packet.posting_version_id
     or (p_binding ->> 'applicationId')::uuid is distinct from v_app.application_id then
    return jsonb_build_object('ok', false, 'code', 'stale', 'detail', 'posting');
  end if;
  if (select max(revision) from public.requirement_sets where posting_version_id = v_packet.posting_version_id) is distinct from (p_binding ->> 'requirementSetRevision')::integer
     or (select max(revision) from public.evidence_mappings where posting_version_id = v_packet.posting_version_id) is distinct from (p_binding ->> 'mappingRevision')::integer then
    return jsonb_build_object('ok', false, 'code', 'stale', 'detail', 'mapping');
  end if;
  for v_id in select jsonb_array_elements_text(p_binding -> 'factVersionIds') loop
    if not public.is_current_fact_version(p_owner, v_id::uuid) then
      return jsonb_build_object('ok', false, 'code', 'stale', 'detail', 'fact');
    end if;
  end loop;
  if p_guard_version is distinct from (p_binding ->> 'guardVersion') or p_template_version is distinct from (p_binding ->> 'templateVersion')
     or p_rendered_sha256 is distinct from (p_binding ->> 'renderedSha256') then
    return jsonb_build_object('ok', false, 'code', 'stale', 'detail', 'versions');
  end if;
  insert into public.packet_renderings (owner_id, packet_id, revision, rendered_lines, rendered_sha256, guard_version, template_version)
    values (p_owner, p_packet_id, p_revision, p_rendered_lines, p_rendered_sha256, p_guard_version, p_template_version)
    on conflict (packet_id, revision) do nothing;
  insert into public.approvals (owner_id, packet_id, revision, rendered_sha256, binding_sha256, binding, request_id)
    values (p_owner, p_packet_id, p_revision, p_rendered_sha256, p_binding_sha256, p_binding, p_request_id)
    on conflict (packet_id, revision, binding_sha256) do nothing;
  update public.applications set selected_packet_id = p_packet_id, selected_packet_revision = p_revision
    where application_id = v_app.application_id;
  -- Approval means ready: only saved/preparing move to approved; real-world progress is never downgraded.
  if v_app.stage in ('saved', 'preparing') then
    perform public.insert_stage_event(p_owner, v_app, 'approved', null, null, 'approve-' || p_request_id::text);
  end if;
  v_result := jsonb_build_object('ok', true, 'approvedAt', now());
  insert into public.request_ledger (owner_id, request_id, operation, fingerprint, result)
    values (p_owner, p_request_id::text, 'draft_approve', v_fp, v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------- function grants
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.approve_fact_version(uuid, uuid)', 'public.withdraw_fact(uuid)',
    'public.approve_role_version(uuid, uuid)', 'public.withdraw_role(uuid)',
    'public.create_posting(uuid, uuid, uuid, text, text, text, text, jsonb, jsonb)',
    'public.save_requirements(uuid, integer, jsonb, jsonb)', 'public.save_mapping(uuid, integer, jsonb)',
    'public.save_packet_revision(uuid, uuid, integer, jsonb)', 'public.add_reply(uuid, uuid, text, jsonb)',
    'public.save_notes(uuid, text)', 'public.apply_stage_change(uuid, integer, text, uuid, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
revoke all on function public.stage_after_reply(text, text) from public, anon;
grant execute on function public.stage_after_reply(text, text) to authenticated;

revoke all on function public.commit_guard_result(uuid, uuid, uuid, integer, bigint, jsonb, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.commit_guard_result(uuid, uuid, uuid, integer, bigint, jsonb, text, text, jsonb, text, text) to service_role;
