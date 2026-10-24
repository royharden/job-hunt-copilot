-- Authority, isolation and race checks for 20261023190000_job_hunt_copilot.sql (PLAN sections 5, 11 M3/M4, 12).
-- AUTHORED UNDER DIRTY MODE, NEVER RUN. Run only against an isolated, throwaway Supabase/Postgres database
-- with the migration applied, connected as a superuser (e.g. `psql -v ON_ERROR_STOP=1 -f`). It creates two
-- synthetic auth users, impersonates them through `request.jwt.claims` + `set local role authenticated`,
-- and RAISEs on any unexpected success or on a failure with the wrong SQLSTATE. Everything runs inside one
-- transaction that is rolled back. The pg_temp helpers need the default TEMP privilege for `authenticated`
-- and `service_role`; if a project revokes it, create the helpers in a granted scratch schema instead.
-- Each check names what_bug_this_catches.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'user-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000b1', 'user-b@example.invalid');

create or replace function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_id::text, true);
end;
$$;

-- Expect the statement to fail with a specific SQLSTATE (42501 privilege/RLS/forbidden, 23503 foreign key,
-- 22023 invalid input, 40001 stale). Success or a different error is a test failure, so a check cannot pass
-- for the wrong reason (for example a NULL hidden by RLS tripping a not-null constraint).
create or replace function pg_temp.expect_fail(p_label text, p_sql text, p_state text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state then
      raise notice 'ok (refused %): %', p_state, p_label;
      return;
    end if;
    raise exception 'WRONG FAILURE for %: expected %, got % (%)', p_label, p_state, sqlstate, sqlerrm;
  end;
  raise exception 'UNEXPECTED SUCCESS: %', p_label;
end;
$$;

-- Expect an RPC returning jsonb {ok:false, code:<code>}.
create or replace function pg_temp.expect_code(p_label text, p_sql text, p_code text) returns void language plpgsql as $$
declare
  v jsonb;
begin
  execute p_sql into v;
  if coalesce(v ->> 'ok', 'true')::boolean or v ->> 'code' is distinct from p_code then
    raise exception 'UNEXPECTED RESULT for %: %', p_label, v;
  end if;
  raise notice 'ok (%): %', p_code, p_label;
end;
$$;

-- ---------------------------------------------------------------- user A builds a minimal graph
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
set local role authenticated;

insert into public.source_versions (document_id, title, body)
  values ('d0000000-0000-4000-8000-000000000001', 'Synthetic resume', 'Built internal Python services for the billing platform.');
insert into public.role_versions (role_id, employer, title, start_month, end_month, is_current, as_of)
  values ('e0000000-0000-4000-8000-000000000001', 'Contoso Ltd', 'Billing Engineer', '2019-03', '2022-06', false, '2026-10');
select public.approve_role_version('e0000000-0000-4000-8000-000000000001',
  (select version_id from public.role_versions where role_id = 'e0000000-0000-4000-8000-000000000001'));
insert into public.fact_versions (fact_id, kind, body, origin)
  values ('a0000000-0000-4000-8000-000000000001', 'accomplishment', 'Built internal Python services for the billing platform.',
          '{"type":"user_attestation","statement":"Built internal Python services for the billing platform."}');
select public.approve_fact_version('a0000000-0000-4000-8000-000000000001',
  (select version_id from public.fact_versions where fact_id = 'a0000000-0000-4000-8000-000000000001'));
select public.create_posting('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-000000000001',
  'Northwind Traders', 'Senior Frontend Engineer', 'Requirements:\n- Python services', null,
  '[]'::jsonb, '[]'::jsonb);

-- what_bug_this_catches: a valid source-span statement refused because its selected quote ends in a newline
-- (whitespace collapse/trim order differing between SQL and the TS core).
insert into public.source_versions (document_id, title, body)
  values ('d0000000-0000-4000-8000-000000000002', 'Span source', E'Cut p95 latency by 12% on the billing API.\nOther line.');
insert into public.fact_versions (fact_id, kind, body, origin, origin_document_version_id)
  select 'a0000000-0000-4000-8000-000000000002', 'accomplishment', 'Cut p95 latency by 12% on the billing API.',
         jsonb_build_object('type', 'source_span', 'documentId', document_id, 'documentVersionId', version_id,
                            'documentSha256', sha256, 'start', 0, 'end', 43,
                            'quote', E'Cut p95 latency by 12% on the billing API.\n'),
         version_id
  from public.source_versions where document_id = 'd0000000-0000-4000-8000-000000000002';
select public.approve_fact_version('a0000000-0000-4000-8000-000000000002',
  (select version_id from public.fact_versions where fact_id = 'a0000000-0000-4000-8000-000000000002'));
-- current_fact_version is not executable by `authenticated`; assert as the superuser, then resume as A.
reset role;
do $$ begin
  if public.current_fact_version('00000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000002') is null then
    raise exception 'source-span fact was not approved';
  end if;
  raise notice 'ok: source-span fact with trailing newline approved';
end $$;
set local role authenticated;

-- what_bug_this_catches: client-written approval state (Grok's client-asserted `approvable`).
select pg_temp.expect_fail('direct INSERT into approvals',
  $$insert into public.approvals (owner_id, packet_id, revision, rendered_sha256, binding_sha256, binding, request_id)
    values (auth.uid(), gen_random_uuid(), 1, repeat('a',64), repeat('b',64), '{}', gen_random_uuid())$$, '42501');
select pg_temp.expect_fail('direct INSERT into packet_renderings (forged grade)',
  $$insert into public.packet_renderings (owner_id, packet_id, revision, rendered_lines, rendered_sha256, guard_version, template_version)
    values (auth.uid(), gen_random_uuid(), 1, '[]', repeat('a',64), 'guard-v1', 'templates-v1')$$, '42501');
-- what_bug_this_catches: stage/revision written around the transaction.
select pg_temp.expect_fail('direct UPDATE of application stage',
  $$update public.applications set stage = 'offer', revision = 99$$, '42501');
select pg_temp.expect_fail('direct INSERT into stage_events',
  $$insert into public.stage_events (owner_id, application_id, from_stage, to_stage, request_id, revision)
    values (auth.uid(), 'c0000000-0000-4000-8000-000000000001', 'saved', 'offer', 'x', 1)$$, '42501');
-- what_bug_this_catches: a reply confirmed without the stage transaction.
select pg_temp.expect_fail('direct INSERT of a confirmed reply',
  $$insert into public.replies (owner_id, reply_id, application_id, body, prediction, chosen_label, confirmed_at)
    values (auth.uid(), gen_random_uuid(), 'c0000000-0000-4000-8000-000000000001', 'x', '{}', 'offer', now())$$, '42501');
-- what_bug_this_catches: approving a profile row by UPDATE instead of the RPC.
select pg_temp.expect_fail('direct UPDATE of fact status',
  $$update public.fact_versions set status = 'approved'$$, '42501');
select pg_temp.expect_fail('INSERT of an already-approved fact',
  $$insert into public.fact_versions (fact_id, kind, body, origin, status)
    values (gen_random_uuid(), 'other', 'x', '{"type":"user_attestation","statement":"x"}', 'approved')$$, '42501');
-- what_bug_this_catches: the service-only commit callable by a signed-in user.
select pg_temp.expect_fail('authenticated calls commit_guard_result',
  $$select public.commit_guard_result(auth.uid(), gen_random_uuid(), gen_random_uuid(), 1, 0, '{}', repeat('a',64), repeat('a',64), '[]', 'guard-v1', 'templates-v1')$$, '42501');

-- Packet with A's own fact.
select public.save_packet_revision('c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', null,
  jsonb_build_array(jsonb_build_object('lineId', 'l1', 'section', 'experience', 'kind', 'fact',
    'fact', jsonb_build_object('factId', 'a0000000-0000-4000-8000-000000000001',
      'versionId', (select version_id from public.fact_versions where fact_id = 'a0000000-0000-4000-8000-000000000001' and status = 'approved')),
    'proposalText', 'Built internal Python services for the billing platform.', 'requirementIds', '[]'::jsonb)));
-- what_bug_this_catches: packet edits overwriting a revision instead of creating a new one.
select pg_temp.expect_fail('save_packet_revision with a stale expected revision',
  $$select public.save_packet_revision('c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 0, '[]')$$, '40001');

-- Stage transaction idempotency and staleness.
select public.apply_stage_change('c0000000-0000-4000-8000-000000000001', 0, 'applied', null, null, 'req-1');
-- what_bug_this_catches: a retried click recording a second event.
do $$ begin
  if (select count(*) from public.stage_events where request_id = 'req-1') <> 1 then raise exception 'expected one event'; end if;
  perform public.apply_stage_change('c0000000-0000-4000-8000-000000000001', 0, 'applied', null, null, 'req-1');
  if (select count(*) from public.stage_events where request_id = 'req-1') <> 1 then raise exception 'retry wrote a second event'; end if;
  raise notice 'ok: identical retry is idempotent';
end $$;
select pg_temp.expect_code('reused request id with a different payload',
  $$select public.apply_stage_change('c0000000-0000-4000-8000-000000000001', 0, 'offer', null, null, 'req-1')$$, 'conflict');
select pg_temp.expect_code('stale expected revision',
  $$select public.apply_stage_change('c0000000-0000-4000-8000-000000000001', 0, 'interview', null, null, 'req-2')$$, 'stale');
-- what_bug_this_catches: an acknowledgement reply recording "applied" or downgrading.
select public.add_reply('99999999-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'We received your application.', '{}');
select pg_temp.expect_code('reply-driven move that is not the rule outcome',
  $$select public.apply_stage_change('c0000000-0000-4000-8000-000000000001', 1, 'saved', '99999999-0000-4000-8000-000000000001', 'acknowledgement', 'req-3')$$,
  'invalid_input');

-- Capture A's ids while A can see them (RLS hides them from B), plus a fresh draft for the approval check.
insert into public.fact_versions (fact_id, kind, body, origin)
  values ('a0000000-0000-4000-8000-000000000001', 'accomplishment', 'Built internal Python services.',
          '{"type":"user_attestation","statement":"Built internal Python services."}');
select set_config('test.a_fact_version',
  (select version_id::text from public.fact_versions where fact_id = 'a0000000-0000-4000-8000-000000000001' and status = 'approved'), true);
select set_config('test.a_draft_version',
  (select version_id::text from public.fact_versions where fact_id = 'a0000000-0000-4000-8000-000000000001' and status = 'draft'), true);

-- ---------------------------------------------------------------- user B: isolation and foreign parents
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1');
set local role authenticated;

-- what_bug_this_catches: cross-user reads.
do $$ begin
  if exists (select 1 from public.fact_versions) or exists (select 1 from public.applications) or exists (select 1 from public.packet_revisions) then
    raise exception 'user B can read user A rows';
  end if;
  raise notice 'ok: user B sees no user A rows';
end $$;
-- what_bug_this_catches: an existing UUID treated as authorization (foreign parent links).
insert into public.skills (skill_id, canonical) values ('c1000000-0000-4000-8000-000000000001', 'Python');
select pg_temp.expect_fail('B links a skill to A''s fact (composite owner FK)',
  $$insert into public.skill_evidence (skill_id, fact_id, fact_version_id)
    values ('c1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
            current_setting('test.a_fact_version')::uuid)$$, '23503');
select pg_temp.expect_fail('B saves a packet on A''s application',
  $$select public.save_packet_revision('c0000000-0000-4000-8000-000000000001', gen_random_uuid(), null, '[]')$$, '42501');
select pg_temp.expect_code('B moves A''s application',
  $$select public.apply_stage_change('c0000000-0000-4000-8000-000000000001', 1, 'offer', null, null, 'b-1')$$, 'forbidden');
select pg_temp.expect_fail('B approves A''s real draft fact version',
  $$select public.approve_fact_version('a0000000-0000-4000-8000-000000000001', current_setting('test.a_draft_version')::uuid)$$, '22023');
-- Confirm the draft is still a draft (checked as A after the B section).

reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
set local role authenticated;
do $$ begin
  if (select status from public.fact_versions where version_id = current_setting('test.a_draft_version')::uuid) <> 'draft' then
    raise exception 'B changed A''s draft';
  end if;
  raise notice 'ok: A''s draft unchanged after B''s attempt';
end $$;

-- ---------------------------------------------------------------- commit_guard_result (service role)
-- The edge function computes the binding with the TS core; here a complete binding is hand-built so each
-- branch of the commit can be reached directly. All keys the commit compares are present.
create or replace function pg_temp.binding(p_packet_rev integer, p_set_rev integer, p_map_rev integer, p_fact uuid) returns jsonb
language sql as $$
  select jsonb_build_object(
    'packetId', 'f0000000-0000-4000-8000-000000000001', 'packetRevision', p_packet_rev,
    'applicationId', 'c0000000-0000-4000-8000-000000000001', 'postingVersionId', 'b0000000-0000-4000-8000-0000000000a1',
    'requirementSetRevision', p_set_rev, 'mappingRevision', p_map_rev, 'factVersionIds', jsonb_build_array(p_fact),
    'guardVersion', 'guard-v1', 'templateVersion', 'templates-v1', 'renderedSha256', repeat('a', 64))
$$;
create or replace function pg_temp.commit(p_request uuid, p_packet_rev integer, p_profile_rev bigint, p_binding jsonb) returns jsonb
language sql as $$
  select public.commit_guard_result('00000000-0000-4000-8000-0000000000a1', p_request, 'f0000000-0000-4000-8000-000000000001',
    p_packet_rev, p_profile_rev, p_binding, repeat('b', 64), repeat('a', 64), '[]'::jsonb, 'guard-v1', 'templates-v1')
$$;
create or replace function pg_temp.profile_rev() returns bigint language sql as $$
  select coalesce((select profile_revision from public.owner_state where owner_id = '00000000-0000-4000-8000-0000000000a1'), 0)
$$;

reset role;
set local role service_role;

-- what_bug_this_catches: a commit refused for every input (a guard that never approves is not a guard).
do $$
declare
  v jsonb;
  v_replay jsonb;
begin
  v := pg_temp.commit('77777777-0000-4000-8000-000000000001', 1, pg_temp.profile_rev(),
                      pg_temp.binding(1, 1, 1, current_setting('test.a_fact_version')::uuid));
  if not coalesce((v ->> 'ok')::boolean, false) then raise exception 'positive control refused: %', v; end if;
  if not exists (select 1 from public.approvals where packet_id = 'f0000000-0000-4000-8000-000000000001' and revision = 1) then
    raise exception 'positive control wrote no approval';
  end if;
  v_replay := pg_temp.commit('77777777-0000-4000-8000-000000000001', 1, pg_temp.profile_rev(),
                             pg_temp.binding(1, 1, 1, current_setting('test.a_fact_version')::uuid));
  if v_replay is distinct from v then raise exception 'identical replay returned %', v_replay; end if;
  if (select count(*) from public.approvals where packet_id = 'f0000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'replay wrote a second approval';
  end if;
  raise notice 'ok: positive control approved once; identical replay idempotent';
end $$;

-- what_bug_this_catches: an approval committed after the profile changed underneath the handler's read.
select pg_temp.expect_code('profile revision moved since the handler read it',
  $$select pg_temp.commit(gen_random_uuid(), 1, -1, pg_temp.binding(1, 1, 1, current_setting('test.a_fact_version')::uuid))$$, 'stale');
-- what_bug_this_catches: a binding for a different packet accepted by the commit.
select pg_temp.expect_code('binding names another packet',
  $$select pg_temp.commit(gen_random_uuid(), 1, pg_temp.profile_rev(),
      pg_temp.binding(1, 1, 1, current_setting('test.a_fact_version')::uuid) || jsonb_build_object('packetId', gen_random_uuid()))$$, 'forbidden');
-- what_bug_this_catches: a malformed binding passing because NULL comparisons are not "stale".
select pg_temp.expect_code('binding missing compared keys',
  $$select pg_temp.commit(gen_random_uuid(), 1, pg_temp.profile_rev(),
      pg_temp.binding(1, 1, 1, current_setting('test.a_fact_version')::uuid) - 'mappingRevision')$$, 'forbidden');
-- what_bug_this_catches: approving against an older evidence mapping.
select pg_temp.expect_code('mapping revision moved',
  $$select pg_temp.commit(gen_random_uuid(), 1, pg_temp.profile_rev(), pg_temp.binding(1, 1, 99, current_setting('test.a_fact_version')::uuid))$$, 'stale');
-- what_bug_this_catches: approving against an older requirement set.
select pg_temp.expect_code('requirement set revision moved',
  $$select pg_temp.commit(gen_random_uuid(), 1, pg_temp.profile_rev(), pg_temp.binding(1, 99, 1, current_setting('test.a_fact_version')::uuid))$$, 'stale');
-- what_bug_this_catches: guard/template version changes not invalidating a binding.
select pg_temp.expect_code('guard version differs',
  $$select pg_temp.commit(gen_random_uuid(), 1, pg_temp.profile_rev(),
      pg_temp.binding(1, 1, 1, current_setting('test.a_fact_version')::uuid) || jsonb_build_object('guardVersion', 'guard-v0'))$$, 'stale');

-- A saves packet revision 2 (as the client would), then the commit for revision 1 is stale.
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select public.save_packet_revision('c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 1, '[]');
reset role;
set local role service_role;
-- what_bug_this_catches: approving a packet revision that is no longer the latest.
select pg_temp.expect_code('packet revision moved',
  $$select pg_temp.commit(gen_random_uuid(), 1, pg_temp.profile_rev(), pg_temp.binding(1, 1, 1, current_setting('test.a_fact_version')::uuid))$$, 'stale');

-- A withdraws the cited fact; even with the NEW profile revision, the fact currency check refuses.
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select public.withdraw_fact('a0000000-0000-4000-8000-000000000001');
reset role; -- the assertion helper is not executable by `authenticated`
do $$ begin
  if public.current_fact_version('00000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001') is not null then
    raise exception 'withdrawal did not make the fact non-current';
  end if;
  raise notice 'ok: withdrawn fact has no current version';
end $$;
reset role;
set local role service_role;
-- what_bug_this_catches: exporting a withdrawn statement through a binding computed before withdrawal.
select pg_temp.expect_code('cited fact withdrawn',
  $$select pg_temp.commit(gen_random_uuid(), 2, pg_temp.profile_rev(), pg_temp.binding(2, 1, 1, current_setting('test.a_fact_version')::uuid))$$, 'stale');

-- Remaining checks need the deployed edge function (pending, see DEVELOPMENT-STATUS.md):
--  * no token or the anon key as bearer -> 401 unauthorized; zero-line packet -> 422 blocked;
--  * a profile/mapping/packet change landing between the handler's reads and its commit call -> 409 stale.

rollback;
