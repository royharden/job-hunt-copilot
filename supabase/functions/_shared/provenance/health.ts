import { mentionsTerm, skillTerms } from "./aliases.ts";
import { checkOrigin, currentFactVersion, currentRoleVersion, findRoleVersion, parseMonth } from "./versions.ts";
import type { FactRef, Profile } from "./types.ts";

export type HealthCode =
  | "missing_evidence"
  | "dangling_ref"
  | "wrong_kind_ref"
  | "broken_alias"
  | "bad_date"
  | "bad_span"
  | "withdrawn_support"
  | "unused_skill";

export type RepairAction =
  | { type: "relink_to_current"; skillId: string; factId: string; fromVersionId: string; toVersionId: string }
  | { type: "remove_link"; skillId: string; factId: string; factVersionId: string }
  | { type: "remove_alias"; skillId: string; alias: string }
  | { type: "edit_fact"; factId: string }
  | { type: "edit_role"; roleId: string }
  | { type: "edit_skill"; skillId: string };

export interface HealthItem {
  code: HealthCode;
  ids: string[];
  reason: string;
  repairs: RepairAction[];
}

export interface HealthReport {
  problems: HealthItem[];
  notes: HealthItem[];
}

const ROLE_KINDS = new Set(["accomplishment", "responsibility", "skill_usage", "project"]);

export function validateProfile(profile: Profile): HealthReport {
  const problems: HealthItem[] = [];
  const notes: HealthItem[] = [];

  for (const role of profile.roles) {
    const start = parseMonth(role.start);
    const end = role.end === null ? null : parseMonth(role.end);
    const asOf = parseMonth(role.asOf);
    const bad =
      start === null ||
      asOf === null ||
      (role.end !== null && end === null) ||
      (end !== null && start !== null && end < start) ||
      (role.current && role.end !== null) ||
      (!role.current && role.end === null);
    if (bad) {
      problems.push({
        code: "bad_date",
        ids: [role.roleId, role.versionId],
        reason: `Role "${role.title}" at ${role.employer} has invalid or inconsistent dates (YYYY-MM; end after start; current roles have no end).`,
        repairs: [{ type: "edit_role", roleId: role.roleId }],
      });
    }
  }

  for (const fact of profile.facts) {
    if (fact.status === "draft") continue;
    const originProblem = checkOrigin(profile, fact.origin);
    if (originProblem) {
      problems.push({
        code: fact.origin.type === "source_span" ? "bad_span" : "missing_evidence",
        ids: [fact.factId, fact.versionId],
        reason: originProblem,
        repairs: [{ type: "edit_fact", factId: fact.factId }],
      });
    }
    if (fact.status !== "approved") continue;
    if (fact.roleRef) {
      const role = findRoleVersion(profile, fact.roleRef);
      if (!role) {
        problems.push({
          code: "dangling_ref",
          ids: [fact.factId, fact.versionId, fact.roleRef.roleVersionId],
          reason: "The fact points at a role version that does not exist.",
          repairs: [{ type: "edit_fact", factId: fact.factId }],
        });
      } else if (role.status === "withdrawn" || currentRoleVersion(profile.roles, role.roleId) === null) {
        problems.push({
          code: "withdrawn_support",
          ids: [fact.factId, fact.versionId, role.versionId],
          reason: "The fact points at a role that has been withdrawn.",
          repairs: [{ type: "edit_fact", factId: fact.factId }],
        });
      }
      if (!ROLE_KINDS.has(fact.kind)) {
        problems.push({
          code: "wrong_kind_ref",
          ids: [fact.factId, fact.versionId],
          reason: `A ${fact.kind} fact cannot reference an employment role. Remove the role reference or change the kind.`,
          repairs: [{ type: "edit_fact", factId: fact.factId }],
        });
      }
    }
  }

  const seenAlias = new Map<string, string>();
  for (const skill of profile.skills) {
    for (const alias of skill.aliases) {
      const key = alias.alias.trim().toLowerCase();
      const owner = seenAlias.get(key);
      if (key.length === 0 || (owner && owner !== skill.skillId) || key === skill.canonical.trim().toLowerCase()) {
        problems.push({
          code: "broken_alias",
          ids: [skill.skillId],
          reason:
            key.length === 0
              ? `Skill "${skill.canonical}" has an empty alias.`
              : owner && owner !== skill.skillId
                ? `Alias "${alias.alias}" is used by two skills.`
                : `Alias "${alias.alias}" repeats the canonical name.`,
          repairs: [{ type: "remove_alias", skillId: skill.skillId, alias: alias.alias }],
        });
      }
      if (key.length > 0 && !owner) seenAlias.set(key, skill.skillId);
    }
  }

  const skillIds = new Set(profile.skills.map((skill) => skill.skillId));
  for (const link of profile.skillEvidence) {
    if (!skillIds.has(link.skillId)) {
      problems.push({
        code: "dangling_ref",
        ids: [link.skillId, link.factId],
        reason: "Skill evidence points at a skill that does not exist.",
        repairs: [{ type: "remove_link", skillId: link.skillId, factId: link.factId, factVersionId: link.factVersionId }],
      });
      continue;
    }
    const exact = profile.facts.find((fact) => fact.factId === link.factId && fact.versionId === link.factVersionId);
    const current = currentFactVersion(profile.facts, link.factId);
    if (!exact) {
      problems.push({
        code: "dangling_ref",
        ids: [link.skillId, link.factId, link.factVersionId],
        reason: "Skill evidence points at a fact version that does not exist.",
        repairs: [{ type: "remove_link", skillId: link.skillId, factId: link.factId, factVersionId: link.factVersionId }],
      });
      continue;
    }
    if (!current || current.versionId !== link.factVersionId) {
      const repairs: RepairAction[] = [];
      if (current) {
        const skill = profile.skills.find((item) => item.skillId === link.skillId);
        const stillNamed = skill ? skillTerms(skill).some((term) => mentionsTerm(current.text, term)) : false;
        if (stillNamed) {
          repairs.push({
            type: "relink_to_current",
            skillId: link.skillId,
            factId: link.factId,
            fromVersionId: link.factVersionId,
            toVersionId: current.versionId,
          });
        }
      }
      repairs.push({ type: "remove_link", skillId: link.skillId, factId: link.factId, factVersionId: link.factVersionId });
      problems.push({
        code: "withdrawn_support",
        ids: [link.skillId, link.factId, link.factVersionId],
        reason: current
          ? "Skill evidence cites an older fact version; the current version must be re-linked deliberately."
          : "Skill evidence cites a withdrawn fact.",
        repairs,
      });
    }
  }

  for (const skill of profile.skills) {
    const used = profile.skillEvidence.some((link) => link.skillId === skill.skillId);
    if (!used) {
      notes.push({
        code: "unused_skill",
        ids: [skill.skillId],
        reason: `Skill "${skill.canonical}" has no linked evidence. It will not support any requirement until a fact is linked.`,
        repairs: [{ type: "edit_skill", skillId: skill.skillId }],
      });
    }
  }

  return { problems, notes };
}

// Only problems touching the selected evidence block a packet; unrelated incomplete facts do not.
// Matching is by exact fact version id (plus any explicit extra ids such as role or skill ids), so a stale
// skill link to an older version does not block a line that cites the current version.
export function blockingProblems(report: HealthReport, selected: FactRef[], extraIds: string[] = []): HealthItem[] {
  const ids = new Set<string>([...selected.map((ref) => ref.versionId), ...extraIds]);
  return report.problems.filter((problem) => problem.ids.some((id) => ids.has(id)));
}
