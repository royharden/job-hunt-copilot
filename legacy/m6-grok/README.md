# Archived: Grok-era model drafting path (optional M6)

These three files are the original Grok build's model prompt builder, response parser and their test.
They are kept unchanged for reference only. PLAN.md (promoted 2026-10-23) makes model rewording an
optional, off-by-default M6 experiment that is not part of the keyless MVP, and says not to carry the
`grok-4.7` constant or the 0.85 probability as validated defaults. Nothing in `src/`, `supabase/` or
`tests/` imports these files, and they are outside `tsconfig.json` and Vitest includes. They target the
pre-promotion types and will not compile against the current core without rework.
