# Job Hunt Copilot

A private, paste-only assistant for one person's job search. You keep approved career statements, paste a
job posting, review its requirements, confirm which of your statements supports each one, assemble an
evidence-linked application packet, approve and copy it, and record your own application progress.

**Status: local Full-mode validation in progress (2026-10-26).** Pinned install, real-library typecheck,
49 unit tests, production build, the frozen synthetic pilot, migration on disposable PostgreSQL, and
the SQL authority script have passed. The approval edge function passes Deno typecheck. Independent
browser/handler/transaction acceptance is pending. Hosted auth and deployment have not been exercised.
See `DEVELOPMENT-STATUS.md` and `docs/LIMITATIONS.md` for boundaries and remaining checks.

## What it does

- **Profile with provenance.** Plain-text source documents; statements created from an exact span of a
  source (UTF-16 offsets into an exact, hashed source version) or from your own attested statement. Roles
  with YYYY-MM dates. Every statement and role is versioned: approved wording never changes, edits create new
  draft versions, withdrawal stops future use and keeps history. Skills have approved aliases and links to
  statements. A health check flags broken spans, bad dates, wrong-kind or dangling references, broken
  aliases and links to superseded versions, with one-click repairs where safe.
- **Requirement review.** Rule-based extraction from the pasted posting keeps the original text span,
  priority (required/preferred) and flags (years, credential, negation, condition, benefit, proficiency,
  mixed). You remove benefits, split mixed clauses, edit and mark each clause reviewed.
- **Confirmed evidence, transparent coverage.** Exact / approved-alias / word-overlap / partial proposals
  are suggestions only; every counted link is confirmed by you, and reviewed gaps are valid answers.
  Coverage = 100 x sum(weight x credit) / sum(weight) with required=2, preferred=1, direct=1, partial=0.5,
  gap/unconfirmed=0. Profile coverage and packet coverage are shown separately; neither is a hiring
  probability or ATS score.
- **Keyless packet.** Assembly selects your approved sentences for confirmed requirements and adds three
  fixed templates (opening, role header, closing). No text is generated. Each line is graded: only
  `verified` lines (exact approved sentence after whitespace normalization, or a fixed template filled from
  current typed sources) can be approved and exported. Edited lines are `unchecked`; recognized unsupported
  claims (added tools, unit swaps, invented numbers, wrong-project metrics, contributed-to-led, etc.) are
  `reverted` with the original sentence offered, or `blocked`. An inspector shows sources and quotes.
- **Approval bound to inputs.** Approval binds the posting version, requirement and mapping revisions,
  selected fact/role/source versions, aliases, tenure assertions, packet revision/order/templates, exact
  rendered bytes (SHA-256) and guard/template versions. Any change makes the approval stale. In live mode
  approval is decided by the `draft-approve` edge function and a service-only database commit; approval
  means "ready", never "applied".
- **Board and replies.** Stages: saved, preparing, approved, applied, interview, offer, rejected, withdrawn.
  Paste a reply: rules suggest a label with the phrases and rule IDs that matched, ignoring quoted mail,
  signatures and negated phrases, and abstaining unless the message clearly names the application. You
  confirm; the stage change, reply confirmation and history event happen in one idempotent transaction.
- **Synthetic demo.** An explicit Setup choice, isolated in browser storage, with labelled fabrications to
  watch the guard work. Demo approvals are labelled demo-local with no server receipt.

No scraping, URL fetching, auto-apply, email sending or reading, model calls, PDF/DOCX handling, embeddings,
teams or hiring predictions.

## Layout

| Path | Contents |
|---|---|
| `supabase/functions/_shared/provenance/` | Pure TypeScript core shared by browser, Deno handler and tests |
| `src/` | React 18 + Vite app: `App.tsx`, `ui/` screens, `lib/` adapters (demo and remote), `demo/capabilities.ts` |
| `supabase/migrations/` | Ordered PostgreSQL schema, RLS, RPCs (applied locally to disposable PostgreSQL; hosting pending) |
| `supabase/functions/draft-approve/` | Authenticated approval/export function (never deployed) |
| `tests/` | Vitest unit tests (49 original tests passed locally) |
| `supabase/tests/` | SQL authority checks passed on disposable PostgreSQL with synthetic auth roles |
| `eval/`, `scripts/eval.ts`, `results/` | Frozen synthetic pilot edition 1, runner and measured local results |
| `legacy/m6-grok/` | Archived, unwired model-drafting code from an earlier build (optional M6, not in the MVP) |

## Running it locally

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run typecheck
npm run eval      # Node 22.6+ (or npx vite-node scripts/eval.ts)
npm run dev -- --host 127.0.0.1   # with no env vars: Setup screen -> Start demo
```

Password recovery opens a new-password form on the auth recovery event, then requires signing out before
normal sign-in. The hosted email/redirect round trip remains unverified and needs platform configuration.

For a live workspace, copy `.env.example` to `.env.local` and set only `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` (public values). Server credentials are injected by the hosting platform into the
edge function and never use a `VITE_` prefix. Provisioning steps are in `BOLT-HANDOFF.md`.

## License

MIT. See `LICENSE`.
