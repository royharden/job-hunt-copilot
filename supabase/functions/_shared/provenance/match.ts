import { mentionsTerm, skillTerms } from "./aliases.ts";
import { LEXICAL_JACCARD, LEXICAL_MIN_SHARED } from "./limits.ts";
import { containsPhrase, significantTokens, uniqueStrings } from "./normalize.ts";
import { currentFacts } from "./versions.ts";
import type { EvidenceProposal, Profile, ProposalTier, RequirementEvidence, RequirementVersion } from "./types.ts";

// Deterministic proposals only (PLAN section 6). Every counted link still needs user confirmation, including
// exact and alias hits: a phrase or alias never proves years, credentials, proficiency or polarity.

const TIER_ORDER: Record<Exclude<ProposalTier, "gap">, number> = { exact: 0, lexical: 1, partial: 2 };

export function proposeForRequirement(requirement: RequirementVersion, profile: Profile): EvidenceProposal[] {
  const clause = requirement.clause;
  const reqTokens = uniqueStrings(significantTokens(clause));
  const facts = currentFacts(profile);
  const proposals: EvidenceProposal[] = [];

  // Skill terms named by the clause, through canonical names or approved aliases.
  const namedSkills = profile.skills.filter((skill) => skillTerms(skill).some((term) => mentionsTerm(clause, term)));

  for (const fact of facts) {
    const factTokens = uniqueStrings(significantTokens(fact.text));
    const factSet = new Set(factTokens);
    const shared = reqTokens.filter((token) => factSet.has(token));
    const union = new Set([...reqTokens, ...factTokens]).size;
    const jaccard = union === 0 ? 0 : shared.length / union;

    const linkedSkill = namedSkills.find((skill) =>
      profile.skillEvidence.some(
        (link) => link.skillId === skill.skillId && link.factId === fact.factId && link.factVersionId === fact.versionId,
      ),
    );
    const phraseHit = clause.length >= 3 && containsPhrase(fact.text, clause);
    const allTokens = reqTokens.length > 0 && shared.length === reqTokens.length;

    let tier: EvidenceProposal["tier"] | null = null;
    let reason = "";
    if (phraseHit || allTokens) {
      tier = "exact";
      reason = phraseHit ? "The requirement phrase appears in this approved sentence." : "Every requirement term appears in this approved sentence.";
    } else if (linkedSkill) {
      tier = "exact";
      reason = `Approved skill "${linkedSkill.canonical}" (or an approved alias) is linked to this sentence.`;
    } else if (shared.length >= LEXICAL_MIN_SHARED && jaccard >= LEXICAL_JACCARD) {
      tier = "lexical";
      reason = `Shares ${shared.length} terms (${shared.join(", ")}); overlap ${jaccard.toFixed(2)}. Word overlap is not proof.`;
    } else if (shared.some((token) => token.length >= 4) || shared.length >= 2) {
      tier = "partial";
      reason = `Related: shares ${shared.join(", ")}.`;
    }
    if (!tier) continue;
    proposals.push({ fact: { factId: fact.factId, versionId: fact.versionId }, tier, reason });
  }

  return proposals
    .sort((left, right) => TIER_ORDER[left.tier] - TIER_ORDER[right.tier] || left.fact.factId.localeCompare(right.fact.factId))
    .slice(0, 5);
}

export function proposedTier(proposals: EvidenceProposal[]): ProposalTier {
  if (proposals.length === 0) return "gap";
  return proposals.reduce<ProposalTier>(
    (best, item) => (TIER_ORDER[item.tier] < TIER_ORDER[best as Exclude<ProposalTier, "gap">] ? item.tier : best),
    proposals[0].tier,
  );
}

// Fresh proposals for every retained requirement. Prior confirmations are kept only when the requirement
// version and every confirmed fact version are unchanged and still current; otherwise they are dropped and
// the requirement needs confirmation again.
export function proposeEvidence(
  requirements: RequirementVersion[],
  profile: Profile,
  previous: RequirementEvidence[] = [],
): RequirementEvidence[] {
  const current = new Set(currentFacts(profile).map((fact) => fact.versionId));
  return requirements
    .filter((requirement) => !requirement.removed)
    .map((requirement) => {
      const proposals = proposeForRequirement(requirement, profile);
      const prior = previous.find((item) => item.requirementId === requirement.requirementId);
      const keep =
        prior?.confirmed &&
        prior.requirementVersionId === requirement.versionId &&
        prior.confirmed.facts.every((ref) => current.has(ref.versionId));
      return {
        requirementId: requirement.requirementId,
        requirementVersionId: requirement.versionId,
        proposals,
        proposedTier: proposedTier(proposals),
        confirmed: keep ? prior!.confirmed : null,
      };
    });
}

// Notes that a confirmation dialog must show next to the clause (constraints a match cannot prove).
export function confirmationWarnings(requirement: RequirementVersion): string[] {
  const warnings: string[] = [];
  if (requirement.flags.includes("years")) {
    warnings.push("Years are not proven by a match. Count it only with an approved duration assertion or usage intervals.");
  }
  if (requirement.flags.includes("credential")) warnings.push("A credential needs a sentence that states the credential itself.");
  if (requirement.flags.includes("proficiency")) warnings.push("Proficiency level is not proven by naming the tool.");
  if (requirement.flags.includes("negation")) warnings.push("The clause contains a negation; check polarity before confirming.");
  if (requirement.flags.includes("condition")) warnings.push("Conditions (location, authorization, travel) need an approved assertion.");
  if (requirement.flags.includes("mixed")) warnings.push("This clause mixes several requirements; split it before confirming.");
  return warnings;
}
