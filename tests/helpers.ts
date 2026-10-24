// Shared test helpers: walk the synthetic demo journey with deterministic ids.
import { extractRequirements, proposeSplit } from "../supabase/functions/_shared/provenance/extract.ts";
import { FACT_REACT_V1, FACT_REACT_V2, sampleProfile, samplePosting } from "../supabase/functions/_shared/provenance/fixtures.ts";
import { proposeEvidence } from "../supabase/functions/_shared/provenance/match.ts";
import type { Profile, RequirementEvidence, RequirementVersion } from "../supabase/functions/_shared/provenance/types.ts";

export function counter(prefix: string): () => string {
  let next = 0;
  return () => `${prefix}-${++next}`;
}

// Journey step 1: apply the offered relink repair for the React skill evidence.
export function repairedProfile(): Profile {
  const profile = sampleProfile();
  const link = profile.skillEvidence.find((item) => item.factVersionId === FACT_REACT_V1);
  if (!link) throw new Error("fixture changed");
  link.factVersionId = FACT_REACT_V2;
  return profile;
}

// Journey steps 2-3: remove benefits, split the mixed clause, review everything, confirm React, Python and
// TypeScript; leave Kubernetes and GraphQL as reviewed gaps and the years clause unconfirmed; confirm the
// latency clause as partial.
export function reviewedJourney(profile: Profile = repairedProfile()): {
  requirements: RequirementVersion[];
  evidence: RequirementEvidence[];
} {
  const posting = samplePosting();
  const requirements: RequirementVersion[] = [];
  let ordinal = 0;
  for (const item of extractRequirements(posting.body)) {
    const parts = item.flags.includes("mixed") ? proposeSplit(item.clause) : [item.clause];
    for (const clause of parts) {
      requirements.push({
        requirementId: `req-${ordinal}`,
        versionId: `req-${ordinal}-v1`,
        postingVersionId: posting.versionId,
        ordinal,
        quote: item.quote,
        clause,
        priority: item.priority,
        flags: parts.length > 1 ? item.flags.filter((flag) => flag !== "mixed") : item.flags,
        reviewed: true,
        removed: item.flags.includes("benefit"),
      });
      ordinal += 1;
    }
  }
  const at = "2026-10-23T00:00:00.000Z";
  const evidence = proposeEvidence(requirements, profile).map((item) => {
    const clause = requirements.find((req) => req.requirementId === item.requirementId)!.clause;
    if (/React|Python|^TypeScript$/.test(clause)) {
      return { ...item, confirmed: { tier: "direct" as const, facts: [item.proposals[0].fact], reason: "confirmed", confirmedAt: at } };
    }
    if (/latency/.test(clause)) {
      return { ...item, confirmed: { tier: "partial" as const, facts: [item.proposals[0].fact], reason: "related", confirmedAt: at } };
    }
    if (/Kubernetes|GraphQL/.test(clause)) {
      return { ...item, confirmed: { tier: "gap" as const, facts: [], reason: "no evidence", confirmedAt: at } };
    }
    return item; // the years clause stays unconfirmed
  });
  return { requirements, evidence };
}
