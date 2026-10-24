# Development status

Phase: **construction only (source written, runtime unverified).** Built 2026-10-23 to 2026-10-24 under a temporary
construction mode that allowed static checks only. Every package was reviewed statically by a separate reviewer
subagent and committed only after a passing review.

## Built

| Milestone (PLAN.md section 11) | State |
|---|---|
| M1 Foundation/profile | Source complete: core types, versions/origins, spans, health and repairs, templates; profile UI |
| M2 Complete keyless demo | Source complete: requirement review, confirmations, two coverages, packet assembly/inspector/guard, fabrication lab, empty gap form, demo-local approval/copy, board, replies, results page |
| M3 Database/live store | Source complete: one ordered migration (RLS, composite owner keys, protected writes, RPCs), remote adapter |
| M4 Authoritative approval | Source complete: `draft-approve` function + service-only `commit_guard_result` |
| M5 Eval/docs | Pilot (60 + 60), runner with baselines, results placeholder, README, LIMITATIONS, this file, LICENSE, BOLT-HANDOFF |
| M6 Optional model rewording | Not built (off by default; out of MVP scope). Older Grok model code is archived unwired in `legacy/m6-grok/` |

## Checks that were actually run (last re-run 2026-10-24 on the final P6 working tree, Node v24.18.0)

- `node --experimental-strip-types --check` on every `.ts` file in the core, tests, eval, scripts, `src/lib`,
  `src/demo`, `_shared/http.ts`: pass. (Node cannot parse `.tsx`.)
- No-emit TypeScript 6.0.3 (an already-installed copy elsewhere on the machine, used read-only), strict
  mode, over core + tests + eval + scripts: 0 errors, with a scratch type stub for `vitest`.
- Same compiler over `src/` (all `.ts` and `.tsx`) with scratch stubs for `react`, `react-dom`,
  `@supabase/supabase-js`: no errors except two stub artifacts. Real library types were not available.
- Same compiler over `supabase/functions/draft-approve/index.ts` with scratch Deno / esm.sh stubs: 0 errors.

## Not run (deferred validation)

| Area | Next step |
|---|---|
| Dependencies | first `npm install` (creates the lockfile), later `npm ci` |
| Unit tests | `npm test` (49 authored Vitest cases; none executed; hand traces are not passes) and `supabase/tests/authority_checks.sql` (authored psql checks; never run) |
| Typecheck/build | `npm run typecheck`, `npm run build` with real types |
| Demo journey | open the app, run PLAN section 8 steps 1-8 with keyboard and mouse |
| Edge function | `deno check`; deploy; no-token and anon-bearer requests rejected; authenticated round trip |
| Database | apply the migration to an isolated/fresh target; check grants, policies, constraints; two-user isolation; foreign-parent and wrong-posting inserts rejected; direct writes to approvals/stage/events refused |
| Approval races | edit a statement, alias, mapping or packet between read and commit -> stale; zero-line refusal; exact bytes |
| Transactions | duplicate / stale / concurrent stage confirmations produce one event; rollback on failure |
| Auth settings | Site URL, confirmation and recovery redirects, sign-out and expiry |
| Account recovery | add a set-new-password step (`PASSWORD_RECOVERY` event + `auth.updateUser`); not built |
| Evaluation | `npm run eval` (Node 22.6+) on frozen edition 1 (60 guard, 60 replies); record counts, denominators and commands in `results/results.md`; list residual semantic failures; expand sparse categories in a new edition before any broad claim |
| Privacy | no diagnostic bodies in logs; demo isolation; deletion/retention policy decided |
