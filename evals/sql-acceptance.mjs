// RV database only, over INT's explicitly offered local trust-auth endpoint. Never docker-exec/stop INT resources.
// Run from repo root: node evals/sql-acceptance.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import pg from "../.agent-work/rv-tooling/node_modules/pg/lib/index.js";
import { computeBinding, bindingSha256 } from "../supabase/functions/_shared/provenance/binding.ts";
import { gatePacket } from "../supabase/functions/_shared/provenance/gate.ts";
import { postingFromRow, packetFromRow, factFromRow } from "../supabase/functions/_shared/provenance/rows.ts";

const config = { host: "127.0.0.1", port: 23110, user: "postgres", password: "rv-synthetic-placeholder",
  ssl: false, connectionTimeoutMillis: 15000, application_name: "s15-rv-acceptance" };
const database = `s15_rv_test_${crypto.randomBytes(4).toString("hex")}`;
const bootstrap = new pg.Client({ ...config, database: "postgres" });
await bootstrap.connect();
await bootstrap.query(`create database ${database}`);
await bootstrap.end();
fs.writeFileSync(".agent-work/rv-db-name.txt", database);
const admin = new pg.Client({ ...config, database });
const clients = [];
const notices = [];
let passed = 0;
const uid = "70000000-0000-4000-8000-000000000001";
const app = "70000000-0000-4000-8000-000000000002";
const posting = "70000000-0000-4000-8000-000000000003";
const version = "70000000-0000-4000-8000-000000000004";
const reply = "70000000-0000-4000-8000-000000000005";
async function asUser(client) {
  await client.query("begin");
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
  await client.query("set local role authenticated");
}
const move = "select public.apply_stage_change($1, $2, $3, $4, $5, $6) as result";
const args = [app, 0, "applied", null, null, "rv-concurrent-identical"];
try {
  await admin.connect();
  admin.on("notice", (notice) => notices.push(notice.message));
  // Existing cluster roles are provided by INT's shim; only create schemas/tables in our new database.
  await admin.query(`create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
        (nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub'))::uuid $$;
    grant usage on schema auth,public to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to service_role;`);
  await admin.query(fs.readFileSync("supabase/migrations/20261023190000_job_hunt_copilot.sql", "utf8")); passed++;
  await admin.query(fs.readFileSync("supabase/tests/authority_checks.sql", "utf8")); passed++;
  fs.writeFileSync(".agent-work/rv-sql-authority-notices.txt", notices.join("\n"));
  await admin.query("insert into auth.users(id,email) values($1,'rv@example.invalid')", [uid]);
  await asUser(admin);
  await admin.query("select public.create_posting($1,$2,$3,'Juniper Test Labs','QA Analyst','Required: regression checks',null,'[]','[]')", [posting, version, app]);
  await admin.query("commit");
  for (let index = 0; index < 2; index++) { const client = new pg.Client({ ...config, database }); await client.connect(); clients.push(client); }
  const [first, second] = clients;
  await asUser(first); await asUser(second);
  const result1 = (await first.query(move, args)).rows[0].result;
  const pending = second.query(move, args);
  // Query a real server lock, rather than assuming two Promise calls overlap.
  let observedLock = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const lock = await admin.query("select count(*)::int n from pg_stat_activity where datname=$1 and wait_event_type='Lock'", [database]);
    if (lock.rows[0].n > 0) { observedLock = true; break; }
    await new Promise((done) => setTimeout(done, 25));
  }
  assert.ok(observedLock, "second same-request transaction must actually wait on first lock");
  await first.query("commit");
  const result2 = (await pending).rows[0].result;
  await second.query("commit");
  assert.equal(result1.ok, true); assert.deepEqual(result2, result1);
  let state = await admin.query("select stage,revision,(select count(*)::int from public.stage_events) events from public.applications where application_id=$1", [app]);
  assert.deepEqual(state.rows[0], { stage: "applied", revision: 1, events: 1 }); passed++;
  await asUser(first);
  assert.equal((await first.query(move, [app, 0, "offer", null, null, args[5]])).rows[0].result.code, "conflict");
  assert.equal((await first.query(move, [app, 0, "offer", null, null, "rv-stale"])).rows[0].result.code, "stale");
  await first.query("select public.add_reply($1,$2,'Juniper Test Labs: not moving forward','{}')", [reply, app]);
  await first.query("commit"); passed++;
  // Fault injection only inside this RV-owned DB. The event insertion fails after reply UPDATE.
  await admin.query(`create function public.rv_event_failure() returns trigger language plpgsql as $$ begin
    if new.request_id='rv-force-rollback' then raise exception 'RV intentional transaction fault'; end if; return new; end $$;
    create trigger rv_force_failure before insert on public.stage_events for each row execute function public.rv_event_failure();`);
  await asUser(first);
  await assert.rejects(first.query(move, [app, 1, "rejected", reply, "rejection", "rv-force-rollback"]), (error) => error.code === "P0001");
  await first.query("rollback");
  state = await admin.query("select a.stage,a.revision,r.confirmed_at,(select count(*)::int from public.stage_events) events from public.applications a cross join public.replies r where a.application_id=$1 and r.reply_id=$2", [app, reply]);
  assert.deepEqual(state.rows[0], { stage: "applied", revision: 1, confirmed_at: null, events: 1 }); passed++;
  await asUser(first);
  const success = (await first.query(move, [app, 1, "rejected", reply, "rejection", "rv-confirm-fresh"])).rows[0].result;
  await first.query("commit"); assert.equal(success.ok, true);
  state = await admin.query("select a.stage,a.revision,r.chosen_label,(r.confirmed_at is not null) confirmed,(select count(*)::int from public.stage_events) events from public.applications a cross join public.replies r where a.application_id=$1 and r.reply_id=$2", [app, reply]);
  assert.deepEqual(state.rows[0], { stage: "rejected", revision: 2, chosen_label: "rejection", confirmed: true, events: 2 }); passed++;
  const packetId = "70000000-0000-4000-8000-000000000006";
  await asUser(first);
  const factId = "70000000-0000-4000-8000-000000000008";
  const factVersion = (await first.query("insert into public.fact_versions(fact_id,kind,body,origin) values($1,'accomplishment',$2,$3) returning version_id",
    [factId, "Wrote regression checks for the Juniper sandbox.", JSON.stringify({ type: "user_attestation", statement: "Synthetic statement approved for RV fixture." })])).rows[0].version_id;
  await first.query("select public.approve_fact_version($1,$2)", [factId, factVersion]);
  await first.query("select public.save_packet_revision($1,$2,null,$3)", [app, packetId, JSON.stringify([
    { lineId: "rv-fact", section: "experience", kind: "fact", fact: { factId, versionId: factVersion },
      proposalText: "Wrote regression checks for the Juniper sandbox.", requirementIds: [] },
    { lineId: "rv-closing", section: "closing", kind: "template", templateId: "generic_closing", role: null,
      proposalText: "Thank you for considering my application.", requirementIds: [] },
  ])]);
  await first.query("commit");
  const packet = packetFromRow((await admin.query("select * from public.packet_revisions where packet_id=$1", [packetId])).rows[0]);
  const target = postingFromRow((await admin.query("select * from public.posting_versions where version_id=$1", [version])).rows[0]);
  const fact = factFromRow((await admin.query("select * from public.fact_versions where version_id=$1", [factVersion])).rows[0]);
  const profile = { sources: [], roles: [], facts: [fact], skills: [], skillEvidence: [] };
  const binding = computeBinding({ applicationId: app, posting: target, requirementSetRevision: 1, mappingRevision: 1, revision: packet, profile });
  const gate = gatePacket(packet, { profile, posting: target }); assert.equal(gate.approvable, true);
  const profileRevision = Number((await admin.query("select profile_revision from public.owner_state where owner_id=$1", [uid])).rows[0]?.profile_revision ?? 0);
  const commitSql = "select public.commit_guard_result($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) result";
  const commitArgs = [uid, "70000000-0000-4000-8000-000000000007", packetId, 1, profileRevision,
    JSON.stringify(binding), bindingSha256(binding), binding.renderedSha256, JSON.stringify(gate.lines), binding.guardVersion, binding.templateVersion];
  await first.query("begin; set local role service_role"); await second.query("begin; set local role service_role");
  const approval1 = (await first.query(commitSql, commitArgs)).rows[0].result;
  const approvalPending = second.query(commitSql, commitArgs);
  let approvalLock = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const locks = await admin.query("select count(*)::int n from pg_stat_activity where datname=$1 and wait_event_type='Lock'", [database]);
    if (locks.rows[0].n) { approvalLock = true; break; }
    await new Promise((done) => setTimeout(done, 25));
  }
  assert.ok(approvalLock, "second approval must contend on a real transaction lock");
  await first.query("commit"); const approval2 = (await approvalPending).rows[0].result; await second.query("commit");
  assert.equal(approval1.ok, true); assert.deepEqual(approval2, approval1);
  const rows = await admin.query("select (select count(*)::int from public.approvals) approvals,(select count(*)::int from public.packet_renderings) renderings,(select count(*)::int from public.request_ledger where operation='draft_approve') ledger");
  assert.deepEqual(rows.rows[0], { approvals: 1, renderings: 1, ledger: 1 }); passed++;
  console.log(JSON.stringify({ database, groupsPassed: passed, builderNotices: notices.length,
    concurrentLockObserved: observedLock, approvalLockObserved: approvalLock, rollbackVerified: true, hostedAuth: "not tested" }, null, 2));
} finally {
  await Promise.allSettled(clients.map((client) => client.end()));
  await admin.end();
  // Keep our synthetic DB for a reviewable receipt; do not delete/stop INT's container or other DBs.
}
