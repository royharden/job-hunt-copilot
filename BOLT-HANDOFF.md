# Bolt infrastructure handoff: Job Hunt Copilot

Full-mode local validation in progress (2026-10-26). Install/typecheck/build/original tests, frozen
evaluation, disposable PostgreSQL migration/authority suite and Deno check passed. Independent runtime
acceptance is pending. No hosted infrastructure has been provisioned or deployed.

## Target and readiness

- Repository / branch / revision: local git repo `job-hunt-copilot`, branch `main` (record the pushed commit here at import time); no remote yet; not pushed or published.
- App root: repository root.
- Database: Bolt Database (Supabase-compatible). Preserve an existing connected provider if one is found at activation.
- Target: fresh empty hosted database expected. Migration applied only to disposable local PostgreSQL.
- Existing hosted baseline / applied migrations: none known; verify intended target history before applying.
- Hosting: Bolt hosting (not chosen yet).
- Publication: prepare only. Do not publish without the owner's explicit authorization.
- Bolt action: inspect and prepare only, until the owner authorizes provisioning.
- Status: keyless MVP (M1-M5) under Full-mode local validation; hosted infrastructure pending. Actual checks and remaining gaps are in `DEVELOPMENT-STATUS.md`.
- Owner prerequisites: GitHub access to the repo once pushed; Bolt Database creation; auth settings below.

## Build and connection

| Item | Exact command or configuration name |
|---|---|
| Runtime / package manager | Verified Node v24.18.0 / npm 11.11.0; committed package-lock.json; `npm run eval` requires Node 22.6+ |
| Frozen install / dev | `npm ci --ignore-scripts --no-audit --no-fund`; `npm run dev -- --host 127.0.0.1 --port <reserved-port> --strictPort` |
| Build / output | `npm run build` (`tsc --noEmit && vite build`); output `dist/` |
| Type/lint/tests | `npm run typecheck`, `npm test` (49 original Vitest cases), `npm run eval` passed locally; no lint script |
| Client file / public env names | `src/lib/supabase.ts`; `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| Missing config behavior | Setup screen with the explicit synthetic demo; no invented URL or key |

## Database

| Order | Exact migration file | Resources / dependencies | Applied status |
|---|---|---|---|
| 1 | `supabase/migrations/20261023190000_job_hunt_copilot.sql` | `pgcrypto`; 18 tables (profile versions, postings, requirement sets, evidence mappings/links, packet revisions/line facts/renderings, approvals, replies, stage events, request ledger, owner state); RLS on all; triggers bumping `owner_state.profile_revision`; RPCs listed below | applied on disposable PostgreSQL 17.6 with synthetic auth roles; hosted pending |

- Access model: private per user. Every table: RLS, owner-only SELECT for `authenticated`, nothing for `anon`.
- Direct client writes: INSERT into `source_versions`, and draft-only INSERT into `role_versions` and `fact_versions` (status forced to draft); INSERT/UPDATE/DELETE on `skills` and `skill_evidence`. Column-level grants exclude owner/status/decision columns.
- RPCs for `authenticated` (SECURITY DEFINER, `search_path` pinned, `auth.uid()` ownership checks): `approve_fact_version`, `withdraw_fact`, `approve_role_version`, `withdraw_role`, `create_posting`, `save_requirements`, `save_mapping`, `save_packet_revision`, `add_reply`, `save_notes`, `apply_stage_change`. Helper `stage_after_reply` is a plain immutable SQL function (pinned search_path, not SECURITY DEFINER), executable by `authenticated`.
- Service-role only: `commit_guard_result` (approval commit). Revoked from `public`, `anon`, `authenticated`.
- Ownership checks: composite `(owner_id, id)` foreign keys for every child; packets reference the application and a posting version of that application's posting.
- Realtime: not required. Seeds: none (the demo is browser-only synthetic data).
- Retry rule: inspect migration tracking, apply only pending changes, preserve existing data; verify a timeout before retrying; report drift instead of dropping or recreating resources.

## Functions

| Name / source | Caller + auth | Input / output | Resources + secret names | Deploy config |
|---|---|---|---|---|
| `draft-approve` / `supabase/functions/draft-approve/index.ts` | signed-in user JWT; handler re-verifies with `auth.getUser`, rejects the anon key as bearer | POST `{packet_id, revision, expected_rendered_sha256?, request_id, wording_attested:false}` -> `{packet:{id,revision,lines,findings,rendered_sha256,input_binding,approval}, export:{plain_text,markdown}, request_id}` or `{error:{code,message}}` | reads owner rows with the user's token (RLS); calls `commit_guard_result` with the service role; `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (platform-injected), optional `ALLOWED_ORIGIN` | `verify_jwt = true` in `supabase/config.toml`; imports `../_shared/**` (verify the deploy tool bundles `_shared`) |

- CORS/preflight: `ALLOWED_ORIGIN` when set, else `*`; methods POST/OPTIONS. CORS is not authentication.
- Identity/ownership and abuse controls: JWT check, ownership via RLS reads, service-only commit that locks the application and re-compares packet/posting/requirement/mapping revisions, fact currency and the profile revision; request-id idempotency.
- Paid API limits: not required (no provider calls in the MVP). Webhooks: not required.

## Server secrets to enter through settings

| Name | Consumer | Required / optional | Owner source |
|---|---|---|---|
| `ALLOWED_ORIGIN` | `draft-approve` | optional (set after the host URL exists) | final site origin |

Platform credentials (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are expected to be injected; verify. Missing configuration returns `missing_config` with no values disclosed. No model/provider key is used (`XAI_API_KEY` from an earlier build is not referenced).

## Auth, storage, and external steps

- Auth: email + password sign-up, sign-in, sign-out, password recovery email.
- Site URL and redirects: set after hosting. The app handles `PASSWORD_RECOVERY`, updates the password and requires signout before normal sign-in. Real hosted email/redirect behavior remains unverified.
- Buckets: not required. Realtime: not required. Scheduled jobs: not required.
- Outside services: none. Explicit demo: browser-only synthetic demo (Setup -> Start demo).
- Undecided by the owner: signup restrictions, account deletion and data retention policy.

## Acceptance checks and receipts

| Check | Expected result | Outcome / receipt |
|---|---|---|
| Import/install/build | branch loads; `npm ci` and `npm run build` pass | local install/build passed; RV frozen install pending; import not attempted |
| Unit tests | `npm test` passes | 49 original tests passed; independent acceptance pending |
| SQL authority script | `supabase/tests/authority_checks.sql` on an isolated database: every check prints ok; transaction rolled back | passed on disposable PostgreSQL 17.6 with synthetic auth roles |
| Schema | migration applies on an empty database; tables, policies, RPCs, grants present | passed locally; actual hosted target pending |
| Function round trip | approve a synthetic packet from the app; `approvals` row and stage event written | pending |
| Auth/isolation | no-token and anon-bearer calls rejected; user B cannot read or write user A rows; direct INSERT/UPDATE on approvals, stage, events, replies' confirmation refused | pending |
| Races | edit a statement/alias/mapping after preview -> approval refused as stale | pending |
| Missing config | `missing_config` without values | pending |

## One prompt after GitHub import

### Inspect and prepare only

> Read BOLT-HANDOFF.md and inspect the imported source at the intended branch/revision. Compare
> proposed resources with implemented files, reconcile unknown migration baselines through
> read-only history/schema inspection when access is available, and report concrete deployment
> gaps and owner/external blockers. Preserve the app design and existing database/data. Prepare
> a reviewable setup plan with actual file/resource names and pending checks. Do not create or
> change cloud resources, apply migrations, deploy functions, enter secrets, enable schedules,
> or publish. Do not describe proposed resources or unexecuted checks as complete.

### Provision backend (only when the owner authorizes it)

> Read BOLT-HANDOFF.md and use its **Bolt Database** target. The implemented code is listed there and the
> actual local checks and remaining gaps are in DEVELOPMENT-STATUS.md. Perform the missing infrastructure setup: create or reuse the specified
> database, check its applied baseline, apply only pending committed migrations in order, deploy the
> `draft-approve` function with `verify_jwt = true`, and configure email/password auth and public env
> settings. Request missing secrets through server settings, never code or chat. Preserve the app and
> existing data; change code only for concrete deployment/wiring issues. Run the acceptance checks above
> and record actual receipts and remaining owner steps. **Prepare hosting without publishing.** Report
> blockers explicitly; do not replace live integrations with mocks or make private resources public.
