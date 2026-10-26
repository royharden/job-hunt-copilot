# Limitations

## What "provenance" means here

A verified line traces to a statement **you** approved, or to a fixed template filled from your approved
role or the posting's title/organisation. It does not certify that the statement is true. The app cannot
check your claims against the world.

## The guard is finite

The checks on edited lines (numbers with units and context, tools and approved aliases, employers, titles,
years, authorship verbs, qualifiers such as "contributed to", negation, direction of change, project
names, additions like p99 or 24/7) are rule-based. They catch the listed patterns; they do not establish
general semantic truth. Known gaps include, for example:

- ordinary prose with no number, known tool, capitalized "at/for/from" organisation or "as" title can pass
  the heuristic guard even when it overstates; this is why the MVP exports **only** exact approved
  sentences and fixed templates, never edited wording;
- the tool lexicon is finite; unknown tools are not detected, and names that collide with English words
  (React, Go, R, C, Rust, Swift, Spark, Excel, Helm, Ruby) count only when you saved them as an approved
  skill or alias, with exact capitalization;
- subject reassignment is detected only through dropped qualifiers ("supported", "helped",
  "contributed to", "as part of", ...); other rephrasings of who did the work are not recognized;
- number parsing covers integers, decimals, grouped thousands, percent, k/M/MM/bn/million/billion,
  multipliers and duration/people units (currency symbols `$`, `€`, `£` only, not codes such as EUR/GBP); ranges and "5+" are treated as ambiguous; lowercase "m" is not read
  as million.

## Matching and coverage

Requirement extraction is line- and heading-based and will miss requirements written as prose. Word overlap
(Jaccard >= 0.34 with >= 2 shared terms) is a proposal heuristic and rarely fires on long sentences.
Nothing counts until you confirm it. A match never proves years, credentials, proficiency or polarity.
Represented role span is the union of dated roles linked to a skill; it is not total experience, and it
counts zero toward a years requirement unless you attest a duration or usage intervals (attested months
take the largest single assertion, not a sum).

## Replies

Reply rules use a fixed phrase list. Quoted-mail and signature stripping is heuristic; anything in a quoted
or signature region never counts as strong evidence. Outcome messages (rejection, interview, offer,
acknowledgement) that do not name the selected organisation or role title stay in review. Newsletters, job
alerts and account emails are labelled `not_applicable` without that naming check and are not held for
review; the evaluation pilot treats them the same way. There are no probabilities. Your confirmation is what records an event.

## Account recovery

Sign-up, sign-in, sign-out, recovery email and a new-password screen exist. Recovery updates the password
and signs out before normal sign-in. Hosted email delivery, redirect settings and real account recovery
have not been exercised in this keyless local run.

## Database and server validation boundaries

The migration and original SQL authority suite passed on disposable PostgreSQL 17.6 with synthetic
Supabase auth roles. The edge function passes Deno 2.5.6 typecheck. Hosted deployment, gateway/JWT
configuration and real Auth are unverified. In particular:

- requirement sets, evidence mappings and packet lines are stored as JSON arrays validated inside RPCs, with
  normalized link tables (`evidence_links`, `packet_line_facts`) whose composite foreign keys enforce
  ownership; original local SQL checks exercise owner isolation and selected foreign-parent paths;
- Postgres does not re-run the TypeScript guard; the edge function runs it and a service-only function
  commits the result after re-checking current revisions, fact currency and a profile revision counter;
- reply predictions are computed in the browser and stored as advisory data; only the user's confirmation
  changes the board;
- source-span offsets are UTF-16 code units checked by the TypeScript core; SQL only checks the source
  version, its hash and that the quote occurs in it;
- account deletion, data retention, signup restrictions, auth callback URLs and `ALLOWED_ORIGIN` are not
  decided.

## Not included

Scraping, URL fetching, automatic or bulk applying, form filling, sending or reading email, inbox OAuth,
background agents, PDF/DOCX import or export, visual resume design, embeddings, model matching or
rewording (the optional M6 experiment is not built), interview or salary coaching, teams, sharing,
billing, multilingual guarantees and hiring predictions. Scholarship/fellowship workflows and AI resume
import are deferred.

## Evaluation

The synthetic pilot (60 guard lines, 60 replies) is small and authored by the builder. Frozen edition 1
ran on 2026-10-26; results/results.md records commands, revision, denominators and residual failures.
Its supplemental heuristic misses a dev added-tool case; MVP export requires exact verified rendering.
Sparse categories support counts rather than general rate claims. No competitor accuracy is implied.
