// Evaluation runner for the frozen synthetic pilot (PLAN section 12). Authored under Dirty Mode and NOT RUN.
// Intended use, only when execution is authorized:  node --experimental-strip-types scripts/eval.ts > results/run.md
// It prints Markdown; copy the output into results/results.md together with the date, Node version, git
// revision and manifest hashes. Rates use null (printed "n/a") for zero denominators; macro-F1 follows the
// usual convention of scoring precision 0 for a label with support but no predictions, and averages only over
// labels that have cases in the split.
// The verified-rendering row grades a line against its FIRST citation only (a packet fact line has one).
// SEED must equal eval/manifest.json "seed" and the case files must match its hashes (checked by hand at
// run time; this script has no file-system access so it stays runnable in any strip-types runtime).
import { GUARD_CASES } from "../eval/guard-cases.ts";
import { REPLY_CASES, REPLY_CONTEXT } from "../eval/reply-cases.ts";
import { classifyReply } from "../supabase/functions/_shared/provenance/classify.ts";
import { samplePosting } from "../supabase/functions/_shared/provenance/fixtures.ts";
import { guardProposal, renderLine } from "../supabase/functions/_shared/provenance/gate.ts";
import { sha256Hex } from "../supabase/functions/_shared/provenance/hash.ts";
import { guardAggregate, replyMetrics } from "../supabase/functions/_shared/provenance/metrics.ts";
import { numericMentions } from "../supabase/functions/_shared/provenance/numbers.ts";
import { GUARD_VERSION, REPLY_RULES_VERSION, TEMPLATE_VERSION } from "../supabase/functions/_shared/provenance/limits.ts";
import { REPLY_LABELS } from "../supabase/functions/_shared/provenance/types.ts";
import type { Grade } from "../supabase/functions/_shared/provenance/types.ts";
import { findFactVersion, isCurrentFact } from "../supabase/functions/_shared/provenance/versions.ts";
import { repairedProfile } from "../tests/helpers.ts";

// Must equal eval/manifest.json "seed"; changing either is a new edition.
const SEED = "s15-pilot-edition-1";

// Deterministic 70/30 dev/heldout split within each class, by sha256(seed + id).
export function split<T extends { id: string }>(cases: T[], classOf: (item: T) => string): Map<string, "dev" | "heldout"> {
  const result = new Map<string, "dev" | "heldout">();
  const classes = [...new Set(cases.map(classOf))];
  for (const cls of classes) {
    const members = cases.filter((item) => classOf(item) === cls).sort((left, right) => sha256Hex(SEED + left.id).localeCompare(sha256Hex(SEED + right.id)));
    const devCount = Math.round(members.length * 0.7);
    members.forEach((item, index) => result.set(item.id, index < devCount ? "dev" : "heldout"));
  }
  return result;
}

const rate = (value: number | null) => (value === null ? "n/a" : value.toFixed(3));

function guardSection(partition: "dev" | "heldout" | "all"): string[] {
  const profile = repairedProfile();
  const posting = samplePosting();
  const splits = split(GUARD_CASES, (item) => (item.expectBlock ? "adversarial" : "supported"));
  const cases = GUARD_CASES.filter((item) => partition === "all" || splits.get(item.id) === partition);

  const heuristic = cases.map((item) => {
    const findings = guardProposal(item.text, item.cites, profile);
    // A whole-sentence recovery exists only for a single, current, approved cited statement (as renderLine does).
    const ref = item.cites.length === 1 ? item.cites[0] : null;
    const recoveryOffered = ref !== null && findFactVersion(profile, ref)?.status === "approved" && isCurrentFact(profile, ref);
    return { expectedBlock: item.expectBlock, blocked: findings.length > 0, recoveryOffered };
  });
  const grades: Record<"supported" | "adversarial", Record<Grade, number>> = {
    supported: { verified: 0, unchecked: 0, reverted: 0, blocked: 0, checked: 0 },
    adversarial: { verified: 0, unchecked: 0, reverted: 0, blocked: 0, checked: 0 },
  };
  const rendered = cases.map((item) => {
    const line = renderLine(
      { lineId: item.id, section: "experience", kind: "fact", fact: item.cites[0] ?? { factId: "none", versionId: "none" }, proposalText: item.text, requirementIds: [] },
      { profile, posting },
    );
    grades[item.expectBlock ? "adversarial" : "supported"][line.grade] += 1;
    return { expectedBlock: item.expectBlock, blocked: line.grade !== "verified", recoveryOffered: line.fallback !== null };
  });
  // Baselines: a guard that never blocks, and a digits-only guard (blocks when a digit string is absent).
  const none = cases.map((item) => ({ expectedBlock: item.expectBlock, blocked: false, recoveryOffered: false }));
  const digits = cases.map((item) => {
    const source = item.cites.map((ref) => findFactVersion(profile, ref)?.text ?? "").join(" ");
    const missing = numericMentions(item.text).some((mention) => !source.includes(mention.raw.replace(/[^0-9.]/g, "")));
    return { expectedBlock: item.expectBlock, blocked: missing, recoveryOffered: false };
  });

  const lines = [
    `### Guard (${partition}, n=${cases.length})`,
    "",
    "Original rejection and accepted replacement are separate: 'recovery offered' counts blocked lines that offer the whole original sentence; accepting it is a new revision, not a pass of the original line.",
    "",
    "| Method | unsupported blocked | supported blocked | recovery offered | TP | FP | FN | TN |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const [name, rows] of [["heuristic guard", heuristic], ["verified rendering", rendered], ["baseline: none", none], ["baseline: digits-only", digits]] as const) {
    const agg = guardAggregate(rows);
    lines.push(
      `| ${name} | ${agg.unsupportedBlocked}/${agg.unsupportedTotal} | ${agg.supportedBlocked}/${agg.supportedTotal} | ${agg.recoveryOffered} | ${agg.confusion.truePositive} | ${agg.confusion.falsePositive} | ${agg.confusion.falseNegative} | ${agg.confusion.trueNegative} |`,
    );
  }
  lines.push(
    "",
    "Verified-rendering grades (MVP export = verified only; this row doubles as the keyless-assembly baseline, since assembly only renders approved sentences and templates):",
    "",
    "| Class | verified | unchecked (review) | reverted (original offered) | blocked |",
    "|---|---|---|---|---|",
  );
  for (const cls of ["supported", "adversarial"] as const) {
    const g = grades[cls];
    lines.push(`| ${cls} | ${g.verified} | ${g.unchecked} | ${g.reverted} | ${g.blocked} |`);
  }
  const categories = [...new Set(cases.filter((item) => item.expectBlock).map((item) => item.category))];
  lines.push("", "Adversarial counts by category (counts only; sparse categories carry no rate claim):", "");
  for (const category of categories) {
    const members = cases.filter((item) => item.category === category && item.expectBlock);
    const blocked = members.filter((item) => guardProposal(item.text, item.cites, profile).length > 0).length;
    lines.push(`- ${category}: ${blocked}/${members.length} blocked`);
  }
  return lines;
}

function replySection(partition: "dev" | "heldout" | "all"): string[] {
  const splits = split(REPLY_CASES, (item) => item.expectedLabel);
  const cases = REPLY_CASES.filter((item) => partition === "all" || splits.get(item.id) === partition);
  const labels = [...REPLY_LABELS] as string[];
  const rules = cases.map((item) => {
    const prediction = classifyReply(item.body, REPLY_CONTEXT);
    return { expected: item.expectedLabel, predicted: prediction.label, needsReview: prediction.needsReview };
  });
  // Baseline: single keywords checked in list-priority order (not text order); never abstains.
  const keywords: Array<[string, string]> = [["offer", "offer"], ["interview", "interview"], ["unfortunately", "rejection"], ["received", "acknowledgement"], ["unsubscribe", "not_applicable"]];
  const keyword = cases.map((item) => {
    const hit = keywords.find(([word]) => item.body.toLowerCase().includes(word));
    return { expected: item.expectedLabel, predicted: hit ? hit[1] : "unknown", needsReview: false };
  });
  const lines = [`### Replies (${partition}, n=${cases.length})`, "", "| Method | macro-F1 | review rate | non-review accuracy (n) |", "|---|---|---|---|"];
  for (const [name, rows] of [["rules", rules], ["baseline: single keyword", keyword]] as const) {
    const metrics = replyMetrics(rows, labels);
    lines.push(`| ${name} | ${rate(metrics.macroF1)} | ${rate(metrics.reviewRate)} | ${rate(metrics.nonReviewAccuracy)} (${metrics.nonReviewCount}) |`);
  }
  const metrics = replyMetrics(rules, labels);
  lines.push("", "| Label | precision (tp/predicted) | recall (tp/support) |", "|---|---|---|");
  for (const item of metrics.perClass) {
    lines.push(
      `| ${item.label} | ${rate(item.precision)} (${item.truePositive}/${item.predicted}) | ${rate(item.recall)} (${item.truePositive}/${item.support}) |`,
    );
  }
  const abstainExpected = cases.filter((item) => item.expectReview);
  const abstained = abstainExpected.filter((item) => classifyReply(item.body, REPLY_CONTEXT).needsReview).length;
  const abstainWrongly = cases.filter((item) => !item.expectReview && classifyReply(item.body, REPLY_CONTEXT).needsReview).length;
  lines.push(
    "",
    `Cases where abstention is correct: ${abstained}/${abstainExpected.length} kept in review.`,
    `Clear cases sent to review anyway: ${abstainWrongly}/${cases.length - abstainExpected.length}.`,
    "",
    "Counts by category (expected label / category: correct label):",
    "",
  );
  for (const category of [...new Set(cases.map((item) => `${item.expectedLabel}/${item.category}`))]) {
    const members = cases.filter((item) => `${item.expectedLabel}/${item.category}` === category);
    const correct = members.filter((item) => classifyReply(item.body, REPLY_CONTEXT).label === item.expectedLabel).length;
    lines.push(`- ${category}: ${correct}/${members.length}`);
  }
  return lines;
}

const output = [
  "# S15 pilot evaluation output",
  "",
  `Seed ${SEED}. Edition 1. Rules: ${GUARD_VERSION}, ${TEMPLATE_VERSION}, ${REPLY_RULES_VERSION}. Synthetic cases only. Keyless assembly needs no evaluation of generated text: it only renders approved sentences and fixed templates.`,
  "",
  ...guardSection("dev"),
  "",
  ...guardSection("heldout"),
  "",
  ...replySection("dev"),
  "",
  ...replySection("heldout"),
];
console.log(output.join("\n"));
