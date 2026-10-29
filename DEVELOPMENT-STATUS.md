# Development status

Phase: **FULL-mode local validation in progress, 2026-10-26.** The 2026-10-23/24 construction baseline
is reused. Current independent acceptance is pending; historical static review was not runtime acceptance.

## Actual local runtime checks (2026-10-26)

- Node v24.18.0, npm 11.11.0. Exact direct dependency versions and committed package-lock.json.
- `npm install --ignore-scripts --no-audit --no-fund`: exit 0, 114 packages.
- `npm test`: exit 0, 49 original tests in 9 files. Independent reviewer tests pending integration.
- `npm run typecheck` and `npm run build`: exit 0 using real types. Build passed again after results/recovery changes.
- `npm run eval`: exit 0, unchanged frozen edition 1; all four LF-normalized manifest hashes matched.
  Full tables and limitations in results/results.md; no heldout tuning or provider calls.
- Migration applied successfully on disposable PostgreSQL 17.6 with synthetic auth roles.
- `supabase/tests/authority_checks.sql`: exit 0, full transaction rolled back. First harness run lacked
  Supabase service-role table grants; corrected local shim, then reran the unchanged script.
- Deno 2.5.6 `check --no-config supabase/functions/draft-approve/index.ts`: exit 0 with real pinned dependency types.
- Local server starts on a claimed loopback port. Browser journey, isolated handler and concurrent SQL acceptance pending.

Hosted platform Auth, gateway/JWT behavior, email/redirects and deployment remain unverified. No cloud provisioning,
real credentials, live provider calls, push or publication occurred.

## Built

| Milestone (PLAN.md section 11) | State |
|---|---|
| M1 Foundation/profile | Source complete: core types, versions/origins, spans, health and repairs, templates; profile UI |
| M2 Complete keyless demo | Source complete: requirement review, confirmations, two coverages, packet assembly/inspector/guard, fabrication lab, empty gap form, demo-local approval/copy, board, replies, results page |
| M3 Database/live store | Source complete: one ordered migration (RLS, composite owner keys, protected writes, RPCs), remote adapter |
| M4 Authoritative approval | Source complete: `draft-approve` function + service-only `commit_guard_result` |
| M5 Eval/docs | Pilot (60 + 60), runner with baselines, results placeholder, README, LIMITATIONS, this file, LICENSE, BOLT-HANDOFF |
| M6 Optional model rewording | Not built (off by default; out of MVP scope). Older Grok model code is archived unwired in `legacy/m6-grok/` |

## Historical construction checks (2026-10-24, Node v24.18.0)

- `node --experimental-strip-types --check` on every `.ts` file in the core, tests, eval, scripts, `src/lib`,
  `src/demo`, `_shared/http.ts`: pass. (Node cannot parse `.tsx`.)
- No-emit TypeScript 6.0.3 (an already-installed copy elsewhere on the machine, used read-only), strict
  mode, over core + tests + eval + scripts: 0 errors, with a scratch type stub for `vitest`.
- Same compiler over `src/` (all `.ts` and `.tsx`) with scratch stubs for `react`, `react-dom`,
  `@supabase/supabase-js`: no errors except two stub artifacts. Real library types were not available.
- Same compiler over `supabase/functions/draft-approve/index.ts` with scratch Deno / esm.sh stubs: 0 errors.

## Remaining validation and owner steps

| Area | Next step |
|---|---|
| Reproducible install | RV repeat `npm ci` against committed lockfile |
| Unit tests | 49 existing tests passed; independent acceptance suite and combined-tree checks pending |
| Typecheck/build | Passed with real types; rerun final combined tree after RV integration |
| Demo journey | open the app, run PLAN section 8 steps 1-8 with keyboard and mouse |
| Edge function | Deno check passed; isolated handler contract tests pending; hosted deployment/Auth deferred |
| Database | Migration/original authority suite passed locally; independent concurrency/expanded authority pending; hosting deferred |
| Approval races | edit a statement, alias, mapping or packet between read and commit -> stale; zero-line refusal; exact bytes |
| Transactions | duplicate / stale / concurrent stage confirmations produce one event; rollback on failure |
| Auth settings | Site URL, confirmation and recovery redirects, sign-out and expiry |
| Account recovery | Screen/event/updateUser implemented; mock regression acceptance and hosted round trip pending |
| Evaluation | Edition 1 executed and recorded; independent verification pending; expand sparse categories in a new edition before broad claims |
| Privacy | no diagnostic bodies in logs; demo isolation; deletion/retention policy decided |
