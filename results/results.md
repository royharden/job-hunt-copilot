# Results

**Not yet measured.**

The synthetic pilot (edition 1: 60 guard lines, 60 replies; see `eval/manifest.json`) is authored and
frozen but has never been executed. Rates whose denominator is zero are printed as "n/a", never 0 or 1 (macro-F1 alone follows the standard convention of precision 0 for a label with support but no predictions, and averages only over labels that have cases in that split). Newsletters, job alerts and account emails are scored as `not_applicable` with no review expected. In edition 1 every `unknown` reply case is a quoted, signature-only, negated or vague message; plain small talk and empty bodies are covered by unit tests, not by the pilot. No block rate, false-block rate, macro-F1, review rate or accuracy
exists for this project, and none should be quoted.

When a run is authorized: `npm run eval` (Node 22.6+; on Node 20 use `npx vite-node scripts/eval.ts`), then record here the date,
Node version, git revision, manifest hashes, and the printed tables (dev and heldout separately, with
denominators). Sparse categories get counts, not rates. Do not tune against heldout cases; changes require
a new edition.
