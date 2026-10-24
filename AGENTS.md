# Agent notes (product repo)

Product commands, once dependencies are installed (none of these has been run yet):

- `npm install` (first time; creates the lockfile - commit it), then `npm ci`
- `npm test` - Vitest over `tests/**/*.test.ts`
- `npm run typecheck` - `tsc --noEmit` (excludes `supabase/functions/draft-approve`, which is Deno)
- `npm run build` / `npm run dev`
- `npm run eval` - prints the synthetic pilot tables (see `results/results.md`)
- Edge function: `deno check supabase/functions/draft-approve/index.ts`

Rules: keep the pure core in `supabase/functions/_shared/provenance/` free of browser/Deno/npm imports;
use explicit `.ts` import extensions; never put server secrets in `VITE_` variables; synthetic data only in
fixtures/eval. Plans, status and agent notes live in the outer folder, not in this repo.
