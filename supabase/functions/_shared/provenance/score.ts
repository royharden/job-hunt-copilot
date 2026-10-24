import type { RenderedLine, RequirementEvidence, RequirementVersion } from "./types.ts";

// Transparent coverage arithmetic (PLAN section 6). Not a hiring probability or ATS score.
//   weight: required 2, preferred 1
//   credit: confirmed direct 1, confirmed partial 0.5, gap or unconfirmed 0
//   denominator: every retained (not removed) reviewed requirement, gaps included
//   percent = 100 * sum(weight * credit) / denominator
// The percentage is withheld while any retained requirement is unreviewed, and absent for an empty set.

export interface CoverageRow {
  requirementId: string;
  weight: number;
  credit: number;
  status: "direct" | "partial" | "gap" | "unconfirmed" | "unreviewed" | "not_in_packet";
}

export interface Coverage {
  rows: CoverageRow[];
  numerator: number;
  denominator: number;
  percent: number | null;
  withheldReason: string | null;
  counts: { direct: number; partial: number; gap: number; unconfirmed: number; unreviewed: number; not_in_packet: number };
  formula: string;
}

const FORMULA = "100 x sum(weight x credit) / sum(weight); required=2, preferred=1; direct=1, partial=0.5, gap/unconfirmed=0";

function weightOf(requirement: RequirementVersion): number {
  return requirement.priority === "required" ? 2 : 1;
}

function summarize(rows: CoverageRow[], requirements: RequirementVersion[]): Coverage {
  const counts = { direct: 0, partial: 0, gap: 0, unconfirmed: 0, unreviewed: 0, not_in_packet: 0 };
  for (const row of rows) counts[row.status] += 1;
  const numerator = rows.reduce((sum, row) => sum + row.weight * row.credit, 0);
  const denominator = rows.reduce((sum, row) => sum + row.weight, 0);
  let withheldReason: string | null = null;
  if (requirements.length === 0) withheldReason = "No requirements retained.";
  else if (counts.unreviewed > 0) withheldReason = `${counts.unreviewed} requirement(s) not reviewed yet.`;
  const percent = withheldReason || denominator === 0 ? null : Math.round((1000 * numerator) / denominator) / 10;
  return { rows, numerator, denominator, percent, withheldReason, counts, formula: FORMULA };
}

// Deduplicate by edited clause (case-insensitive) so a pasted duplicate counts once.
export function retainedRequirements(requirements: RequirementVersion[]): RequirementVersion[] {
  const seen = new Set<string>();
  const out: RequirementVersion[] = [];
  for (const requirement of [...requirements].sort((left, right) => left.ordinal - right.ordinal)) {
    if (requirement.removed) continue;
    const key = requirement.clause.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(requirement);
  }
  return out;
}

function baseRow(requirement: RequirementVersion, evidence: RequirementEvidence | undefined): CoverageRow {
  const weight = weightOf(requirement);
  if (!requirement.reviewed) return { requirementId: requirement.requirementId, weight, credit: 0, status: "unreviewed" };
  const confirmed = evidence && evidence.requirementVersionId === requirement.versionId ? evidence.confirmed : null;
  if (!confirmed) return { requirementId: requirement.requirementId, weight, credit: 0, status: "unconfirmed" };
  if (confirmed.tier === "direct") return { requirementId: requirement.requirementId, weight, credit: 1, status: "direct" };
  if (confirmed.tier === "partial") return { requirementId: requirement.requirementId, weight, credit: 0.5, status: "partial" };
  return { requirementId: requirement.requirementId, weight, credit: 0, status: "gap" };
}

export function profileCoverage(requirements: RequirementVersion[], evidence: RequirementEvidence[]): Coverage {
  const retained = retainedRequirements(requirements);
  const rows = retained.map((requirement) =>
    baseRow(requirement, evidence.find((item) => item.requirementId === requirement.requirementId)),
  );
  return summarize(rows, retained);
}

// Packet view: a requirement keeps its credit only when a retained verified line renders one of the fact
// versions confirmed for it. Each requirement counts once. Removing or blocking a line can lower this view
// without changing profile coverage.
export function packetCoverage(
  requirements: RequirementVersion[],
  evidence: RequirementEvidence[],
  lines: RenderedLine[],
): Coverage {
  const retained = retainedRequirements(requirements);
  const verifiedFactVersions = new Set(
    lines
      .filter((line) => line.grade === "verified")
      .flatMap((line) => line.sources.filter((source) => source.kind === "fact").map((source) => source.versionId)),
  );
  const rows = retained.map((requirement) => {
    const item = evidence.find((entry) => entry.requirementId === requirement.requirementId);
    const row = baseRow(requirement, item);
    if (row.status !== "direct" && row.status !== "partial") return row;
    const represented = item!.confirmed!.facts.some((ref) => verifiedFactVersions.has(ref.versionId));
    return represented ? row : { ...row, credit: 0, status: "not_in_packet" as const };
  });
  return summarize(rows, retained);
}
