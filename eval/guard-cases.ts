// Frozen synthetic guard pilot, edition 1 (PLAN section 12): 30 supported + 30 adversarial lines against the
// repaired synthetic demo profile. Authored 2026-10-23 under Dirty Mode; NOT YET RUN.
// Two measures are reported separately by scripts/eval.ts:
//   heuristic guard  - guardProposal() findings (finite checks; what an optional M6 "checked" path would use)
//   verified render  - renderLine() grade; in the MVP only exact approved sentences/templates are exportable
// Do not tune against the heldout split; fixes require a new edition (new file + manifest entry).
import {
  FACT_DEGREE,
  FACT_DEGREE_V1,
  FACT_LATENCY,
  FACT_LATENCY_V1,
  FACT_LEDGER,
  FACT_LEDGER_V1,
  FACT_MIGRATION,
  FACT_MIGRATION_V1,
  FACT_PYTHON,
  FACT_PYTHON_V1,
  FACT_REACT,
  FACT_REACT_V1,
  FACT_REACT_V2,
  UNKNOWN_FACT,
} from "../supabase/functions/_shared/provenance/fixtures.ts";

export interface GuardCase {
  id: string;
  origin: "authored-synthetic";
  category: string;
  text: string;
  cites: Array<{ factId: string; versionId: string }>;
  expectBlock: boolean;
  whatBugThisCatches: string;
}

const py = { factId: FACT_PYTHON, versionId: FACT_PYTHON_V1 };
const lat = { factId: FACT_LATENCY, versionId: FACT_LATENCY_V1 };
const mig = { factId: FACT_MIGRATION, versionId: FACT_MIGRATION_V1 };
const react = { factId: FACT_REACT, versionId: FACT_REACT_V2 };
const ledger = { factId: FACT_LEDGER, versionId: FACT_LEDGER_V1 };
const degree = { factId: FACT_DEGREE, versionId: FACT_DEGREE_V1 };

function supported(id: string, category: string, text: string, cites: GuardCase["cites"], bug: string): GuardCase {
  return { id, origin: "authored-synthetic", category, text, cites, expectBlock: false, whatBugThisCatches: bug };
}

function adversarial(id: string, category: string, text: string, cites: GuardCase["cites"], bug: string): GuardCase {
  return { id, origin: "authored-synthetic", category, text, cites, expectBlock: true, whatBugThisCatches: bug };
}

const EXACT = "Over-blocking an exact approved sentence.";
const FAITHFUL = "Over-blocking a faithful rewording that adds no claim.";

export const GUARD_CASES: GuardCase[] = [
  // Supported: exact approved sentences and whitespace variants (verified rendering).
  supported("g-s01", "exact", "Built internal Python services for the billing platform.", [py], EXACT),
  supported("g-s02", "exact", "Cut p95 latency by 12% on the billing API.", [lat], EXACT),
  supported("g-s03", "exact", "Contributed to the migration of the payments API to TypeScript.", [mig], EXACT),
  supported("g-s04", "exact", "Built React dashboards used by 40 support agents.", [react], EXACT),
  supported("g-s05", "exact", "Reduced nightly reconciliation time from 6 hours to 90 minutes on the Ledger project.", [ledger], EXACT),
  supported("g-s06", "exact", "B.S. in Computer Science, Example State University, 2018.", [degree], EXACT),
  supported("g-s07", "whitespace", "  Built internal Python services   for the billing platform. ", [py], "Whitespace-only differences treated as edits."),
  supported("g-s08", "whitespace", "Cut p95 latency by 12%\non the billing API.", [lat], "A line break inside an approved sentence treated as an edit."),
  supported("g-s09", "whitespace", "Built React dashboards used by\t40 support agents.", [react], "Tab whitespace treated as an edit."),
  supported("g-s10", "whitespace", "Contributed to the migration of the payments API to TypeScript.  ", [mig], "Trailing whitespace treated as an edit."),
  supported("g-s11", "extra_citation", "Reduced nightly reconciliation time from 6 hours to 90 minutes on the Ledger project.", [ledger, react], "A same-role extra citation causes a block."),
  supported("g-s12", "extra_citation", "Built internal Python services for the billing platform.", [py, lat], "A same-role extra citation causes a block."),
  supported("g-s13", "whitespace", "B.S. in Computer Science, Example State University,  2018.", [degree], "Double space before a year treated as an edit."),
  supported("g-s14", "extra_citation", "Cut p95 latency by 12% on the billing API.", [lat, py], "Same-role second citation causes a block."),
  supported("g-s15", "extra_citation", "Built React dashboards used by 40 support agents.", [react, mig], "Same-role second citation causes a block."),
  // Supported: faithful rewordings with no added claim (heuristic guard should pass; render stays unchecked).
  supported("g-s16", "faithful", "Built Python services for the billing platform.", [py], FAITHFUL),
  supported("g-s17", "faithful", "Built internal billing-platform services in Python.", [py], FAITHFUL),
  supported("g-s18", "faithful", "Cut p95 latency on the billing API by 12%.", [lat], FAITHFUL),
  supported("g-s19", "faithful", "Billing API p95 latency cut by 12%.", [lat], FAITHFUL),
  supported("g-s20", "faithful", "Contributed to migrating the payments API to TypeScript.", [mig], FAITHFUL),
  supported("g-s21", "faithful", "Contributed to the payments API migration to TypeScript.", [mig], FAITHFUL),
  supported("g-s22", "faithful", "Built React dashboards for 40 support agents.", [react], FAITHFUL),
  supported("g-s23", "faithful", "Built dashboards in React used by 40 support agents.", [react], FAITHFUL),
  supported("g-s24", "faithful", "Reduced the nightly reconciliation from 6 hours to 90 minutes on the Ledger project.", [ledger], FAITHFUL),
  supported("g-s25", "faithful", "On the Ledger project, reduced nightly reconciliation time from 6 hours to 90 minutes.", [ledger], FAITHFUL),
  supported("g-s26", "faithful", "Earned a B.S. in Computer Science from Example State University in 2018.", [degree], FAITHFUL),
  supported("g-s27", "faithful", "Built internal Python services.", [py], "Shortening by deletion flagged as a new claim."),
  supported("g-s28", "faithful", "Built React dashboards.", [react], "Shortening by deletion flagged as a new claim."),
  supported("g-s29", "faithful", "Cut p95 latency by 12%.", [lat], "Shortening by deletion flagged as a new claim."),
  supported("g-s30", "faithful", "Contributed to the TypeScript migration of the payments API.", [mig], FAITHFUL),

  // Adversarial (must be blocked by the heuristic guard; never verified).
  adversarial("g-a01", "added_tool", "Administered Kubernetes clusters for the billing platform.", [py], "A gap tool inserted into an unrelated cited sentence."),
  adversarial("g-a02", "added_tool", "Built internal Python and Go services for the billing platform.", [py], "A collision-prone tool name added beside a real one."),
  adversarial("g-a03", "added_tool", "Built internal Java services for the billing platform.", [py], "Java treated as supported by an unrelated sentence."),
  adversarial("g-a04", "added_tool", "Built React dashboards on AWS used by 40 support agents.", [react], "A cloud provider added to a real accomplishment."),
  adversarial("g-a05", "unit_swap", "Built React dashboards used by 40% of support agents.", [react], "A people count re-expressed as a percentage."),
  adversarial("g-a06", "unit_swap", "Cut p95 latency by 12 ms on the billing API.", [lat], "A percentage re-expressed as milliseconds."),
  adversarial("g-a07", "unit_swap", "Reduced nightly reconciliation time from 6 minutes to 90 minutes on the Ledger project.", [ledger], "Hours changed to minutes."),
  adversarial("g-a08", "invented_number", "Cut p95 latency by 40% on the billing API.", [lat], "A larger metric substituted."),
  adversarial("g-a09", "invented_number", "Built React dashboards used by 400 support agents.", [react], "A count inflated tenfold."),
  adversarial("g-a10", "magnitude", "Saved $3M by building internal Python services for the billing platform.", [py], "An invented money figure in magnitude notation."),
  adversarial("g-a11", "magnitude", "Built internal Python services handling 10k requests for the billing platform.", [py], "An invented 10k figure."),
  adversarial("g-a12", "wrong_project", "Cut p95 latency by 12% on the Ledger project.", [lat], "A real metric moved onto another project."),
  adversarial("g-a13", "pooled", "Cut p95 latency by 12% while serving 40 support agents.", [lat, react], "Numbers pooled from two different sentences."),
  adversarial("g-a14", "verb_escalation", "Led the migration of the payments API to TypeScript.", [mig], "Contributed-to escalated to led."),
  adversarial("g-a15", "verb_escalation", "Architected internal Python services for the billing platform.", [py], "Built escalated to architected."),
  adversarial("g-a16", "verb_escalation", "Led the migration.", [py], "Grok's original unsupported-leadership fixture."),
  adversarial("g-a17", "scope_change", "Migrated the payments API to TypeScript.", [mig], "Contribution qualifier silently dropped."),
  adversarial("g-a18", "polarity", "Did not build internal Python services for the billing platform.", [py], "Negation inserted with high word overlap."),
  adversarial("g-a19", "direction", "Increased p95 latency by 12% on the billing API.", [lat], "Direction of change reversed with high overlap."),
  adversarial("g-a20", "title_escalation", "Served as Staff Engineer building Python services for the billing platform.", [py], "Engineer escalated to Staff Engineer."),
  adversarial("g-a21", "invented_employer", "Built internal Python services for the billing platform at Initech.", [py], "An employer that is not the cited role."),
  adversarial("g-a22", "invented_year", "Built internal Python services for the billing platform in 2017.", [py], "A year outside the cited role dates."),
  adversarial("g-a23", "addition", "Cut p99 latency by 12% on the billing API.", [lat], "p95 changed to p99."),
  adversarial("g-a24", "addition", "Kept the billing API available 24/7 while cutting p95 latency by 12%.", [lat], "An always-on claim added."),
  adversarial("g-a25", "phantom_ref", "Built internal Python services for the billing platform.", [{ factId: UNKNOWN_FACT, versionId: "phantom" }], "A citation to a statement that does not exist."),
  adversarial("g-a26", "stale_ref", "Built React dashboards for support agents.", [{ factId: FACT_REACT, versionId: FACT_REACT_V1 }], "A citation to a superseded version."),
  adversarial("g-a27", "uncited", "Built internal Python services for the billing platform.", [], "A line with no citation."),
  adversarial("g-a28", "added_tool", "Contributed to the migration of the payments API to TypeScript and GraphQL.", [mig], "A gap requirement appended to a real sentence."),
  adversarial("g-a29", "invented_number", "Reduced nightly reconciliation time from 8 hours to 90 minutes on the Ledger project.", [ledger], "The before-value inflated."),
  adversarial("g-a30", "verb_escalation", "Owned the React dashboards used by 40 support agents.", [react], "Built escalated to owned."),
];
