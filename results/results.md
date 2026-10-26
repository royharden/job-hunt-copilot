# Results

Executed locally 2026-10-26 in FULL mode on Node v24.18.0, commit 6cda59f273ab71a5e2ebdc5220cfe072fa09113d. Frozen edition 1: 60 guard and 60 reply cases; all four LF-normalized manifest hashes verified before execution. Command: `npm run eval`. No provider/model calls.

Verified rendering refused 30/30 adversarial proposals and withheld 15/30 supported paraphrases: exact source wording is intentionally required for export. The supplemental heuristic missed one dev added-tool case and blocked one supported dev case; it is not the MVP export authority. Reply rules macro-F1 dev 0.926 (42 cases), heldout 1.000 (18 cases); all 22 cases expected to abstain remained in review, and five clear cases were conservatively sent to review. Synthetic pilot only; sparse categories do not establish general accuracy. No heldout tuning or fixture changes.

# S15 pilot evaluation output

Seed s15-pilot-edition-1. Edition 1. Rules: guard-v1, templates-v1, reply-rules-v1. Synthetic cases only. Keyless assembly needs no evaluation of generated text: it only renders approved sentences and fixed templates.

### Guard (dev, n=42)

Original rejection and accepted replacement are separate: 'recovery offered' counts blocked lines that offer the whole original sentence; accepting it is a new revision, not a pass of the original line.

| Method | unsupported blocked | supported blocked | recovery offered | TP | FP | FN | TN |
|---|---|---|---|---|---|---|---|
| heuristic guard | 20/21 | 1/21 | 16 | 20 | 1 | 1 | 20 |
| verified rendering | 21/21 | 12/21 | 30 | 21 | 12 | 0 | 9 |
| baseline: none | 0/21 | 0/21 | 0 | 0 | 0 | 21 | 21 |
| baseline: digits-only | 3/21 | 0/21 | 0 | 3 | 0 | 18 | 21 |

Verified-rendering grades (MVP export = verified only; this row doubles as the keyless-assembly baseline, since assembly only renders approved sentences and templates):

| Class | verified | unchecked (review) | reverted (original offered) | blocked |
|---|---|---|---|---|
| supported | 9 | 12 | 0 | 0 |
| adversarial | 0 | 1 | 17 | 3 |

Adversarial counts by category (counts only; sparse categories carry no rate claim):

- added_tool: 2/3 blocked
- unit_swap: 1/1 blocked
- invented_number: 1/1 blocked
- magnitude: 2/2 blocked
- wrong_project: 1/1 blocked
- pooled: 1/1 blocked
- verb_escalation: 3/3 blocked
- scope_change: 1/1 blocked
- polarity: 1/1 blocked
- direction: 1/1 blocked
- title_escalation: 1/1 blocked
- invented_employer: 1/1 blocked
- addition: 1/1 blocked
- phantom_ref: 1/1 blocked
- stale_ref: 1/1 blocked
- uncited: 1/1 blocked

### Guard (heldout, n=18)

Original rejection and accepted replacement are separate: 'recovery offered' counts blocked lines that offer the whole original sentence; accepting it is a new revision, not a pass of the original line.

| Method | unsupported blocked | supported blocked | recovery offered | TP | FP | FN | TN |
|---|---|---|---|---|---|---|---|
| heuristic guard | 9/9 | 0/9 | 9 | 9 | 0 | 0 | 9 |
| verified rendering | 9/9 | 3/9 | 12 | 9 | 3 | 0 | 6 |
| baseline: none | 0/9 | 0/9 | 0 | 0 | 0 | 9 | 9 |
| baseline: digits-only | 4/9 | 0/9 | 0 | 4 | 0 | 5 | 9 |

Verified-rendering grades (MVP export = verified only; this row doubles as the keyless-assembly baseline, since assembly only renders approved sentences and templates):

| Class | verified | unchecked (review) | reverted (original offered) | blocked |
|---|---|---|---|---|
| supported | 6 | 3 | 0 | 0 |
| adversarial | 0 | 0 | 9 | 0 |

Adversarial counts by category (counts only; sparse categories carry no rate claim):

- added_tool: 2/2 blocked
- unit_swap: 2/2 blocked
- invented_number: 2/2 blocked
- invented_year: 1/1 blocked
- addition: 1/1 blocked
- verb_escalation: 1/1 blocked

### Replies (dev, n=42)

| Method | macro-F1 | review rate | non-review accuracy (n) |
|---|---|---|---|
| rules | 0.926 | 0.429 | 1.000 (24) |
| baseline: single keyword | 0.384 | 0.000 | 0.357 (42) |

| Label | precision (tp/predicted) | recall (tp/support) |
|---|---|---|
| rejection | 0.875 (7/8) | 1.000 (7/7) |
| interview | 0.875 (7/8) | 1.000 (7/7) |
| offer | 1.000 (7/7) | 1.000 (7/7) |
| acknowledgement | 1.000 (6/6) | 0.857 (6/7) |
| not_applicable | 1.000 (7/7) | 1.000 (7/7) |
| unknown | 0.833 (5/6) | 0.714 (5/7) |

Cases where abstention is correct: 15/15 kept in review.
Clear cases sent to review anyway: 3/27.

Counts by category (expected label / category: correct label):

- rejection/clear: 5/5
- rejection/wrong_context: 1/1
- unknown/vague: 0/1
- rejection/contrast: 1/1
- interview/clear: 6/6
- unknown/signature_only: 1/1
- unknown/quoted_only: 2/2
- unknown/general: 0/1
- unknown/negated: 2/2
- interview/wrong_context: 1/1
- offer/clear: 4/4
- offer/attached: 1/1
- offer/contrast: 1/1
- offer/wrong_context: 1/1
- acknowledgement/clear: 4/5
- acknowledgement/wrong_context: 1/1
- acknowledgement/courtesy: 1/1
- not_applicable/account: 2/2
- not_applicable/newsletter: 3/3
- not_applicable/alert: 1/1
- not_applicable/mixed: 1/1

### Replies (heldout, n=18)

| Method | macro-F1 | review rate | non-review accuracy (n) |
|---|---|---|---|
| rules | 1.000 | 0.500 | 1.000 (9) |
| baseline: single keyword | 0.339 | 0.000 | 0.389 (18) |

| Label | precision (tp/predicted) | recall (tp/support) |
|---|---|---|
| rejection | 1.000 (3/3) | 1.000 (3/3) |
| interview | 1.000 (3/3) | 1.000 (3/3) |
| offer | 1.000 (3/3) | 1.000 (3/3) |
| acknowledgement | 1.000 (3/3) | 1.000 (3/3) |
| not_applicable | 1.000 (3/3) | 1.000 (3/3) |
| unknown | 1.000 (3/3) | 1.000 (3/3) |

Cases where abstention is correct: 7/7 kept in review.
Clear cases sent to review anyway: 2/11.

Counts by category (expected label / category: correct label):

- unknown/quoted_only: 3/3
- rejection/clear: 3/3
- interview/clear: 2/2
- interview/wrong_context: 1/1
- offer/clear: 2/2
- offer/wrong_context: 1/1
- acknowledgement/courtesy: 2/2
- acknowledgement/clear: 1/1
- not_applicable/newsletter: 1/1
- not_applicable/alert: 2/2
