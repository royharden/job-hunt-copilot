import { digest } from "../../supabase/functions/_shared/provenance/hash.ts";
import type { RequirementEvidence, RequirementSet, RequirementVersion } from "../../supabase/functions/_shared/provenance/types.ts";
import { RepoError, type EvidenceDecision, type RequirementEdit } from "./repository.ts";

// Pure revision builders shared by the demo and remote adapters so both produce identical versions.

// A requirement keeps its version id only when its content is unchanged; "reviewed" is review state, not
// content, so ticking it does not discard confirmations.
export function nextRequirements(
  set: RequirementSet,
  postingVersionId: string,
  edits: RequirementEdit[],
  newId: () => string,
  postingBody: string,
): RequirementVersion[] {
  return edits.map((edit, ordinal) => {
    const prior = edit.requirementId ? set.requirements.find((item) => item.requirementId === edit.requirementId) : undefined;
    if (edit.requirementId && !prior) throw new RepoError("invalid_input", "Unknown requirement.");
    // A new (split or added) clause may only point at original text that really is that span of the posting.
    const claimed = edit.quote;
    const validQuote = claimed && postingBody.slice(claimed.start, claimed.end) === claimed.text ? claimed : null;
    const quote = prior ? prior.quote : validQuote;
    const sameContent =
      prior &&
      prior.clause === edit.clause &&
      prior.priority === edit.priority &&
      prior.removed === edit.removed &&
      digest(prior.flags) === digest(edit.flags);
    return {
      requirementId: prior?.requirementId ?? newId(),
      versionId: sameContent ? prior!.versionId : newId(),
      postingVersionId,
      ordinal,
      quote,
      clause: edit.clause,
      priority: edit.priority,
      flags: edit.flags,
      reviewed: edit.reviewed,
      removed: edit.removed,
    };
  });
}

export function confirmInEvidence(
  evidence: RequirementEvidence[],
  requirement: RequirementVersion,
  decision: EvidenceDecision | null,
  now: string,
): RequirementEvidence[] {
  if (requirement.removed) throw new RepoError("invalid_input", "Removed requirements are not confirmed.");
  if (!requirement.reviewed) throw new RepoError("invalid_input", "Review the requirement wording before confirming evidence.");
  if (!evidence.some((item) => item.requirementId === requirement.requirementId && item.requirementVersionId === requirement.versionId)) {
    throw new RepoError("stale", "Proposals are out of date. Refresh them first.");
  }
  return evidence.map((item) =>
    item.requirementId === requirement.requirementId
      ? { ...item, confirmed: decision ? { ...decision, confirmedAt: now } : null }
      : item,
  );
}
