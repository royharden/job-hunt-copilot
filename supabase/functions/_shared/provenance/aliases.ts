import { digest } from "./hash.ts";
import { findLexiconTerms } from "./lexicon.ts";
import { currentFactVersion, findRoleVersion, formatMonth, parseMonth } from "./versions.ts";
import type { Profile, Skill } from "./types.ts";

// Names that are also ordinary English words or single letters. They count only as an approved skill
// term with exact capitalization, never through the lexicon or case-insensitive matching.
export const COLLISION_TERMS = new Set(["React", "Go", "R", "C", "Rust", "Swift", "Spark", "Excel", "Helm", "Ruby"]);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function termPattern(term: string): RegExp {
  const flags = COLLISION_TERMS.has(term) ? "u" : "iu";
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}+#])`, flags);
}

export function mentionsTerm(text: string, term: string): boolean {
  if (term.trim().length === 0) return false;
  return termPattern(term.trim()).test(text);
}

export function skillTerms(skill: Skill): string[] {
  return [skill.canonical, ...skill.aliases.filter((alias) => alias.approved).map((alias) => alias.alias)]
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}

export interface ToolMention {
  term: string;
  skillId: string | null; // null when known only from the finite lexicon
}

// Tools/skills named in a line: approved profile skill terms first, then lexicon terms not already covered.
// Unknown words stay unknown: absence from both lists is not evidence either way.
export function toolMentions(text: string, skills: Skill[]): ToolMention[] {
  const found: ToolMention[] = [];
  const covered = new Set<string>();
  for (const skill of skills) {
    for (const term of skillTerms(skill)) {
      if (mentionsTerm(text, term)) {
        found.push({ term, skillId: skill.skillId });
        covered.add(term.toLowerCase());
        covered.add(skill.canonical.toLowerCase());
        break;
      }
    }
  }
  for (const term of findLexiconTerms(text)) {
    if (COLLISION_TERMS.has(term) || covered.has(term.toLowerCase())) continue;
    found.push({ term, skillId: null });
  }
  return found;
}

// A tool mention is supported by a cited sentence when the sentence names the same tool through the
// canonical name or any approved alias of that skill (or the same lexicon term when not a profile skill).
export function sentenceSupportsTool(sentence: string, mention: ToolMention, skills: Skill[]): boolean {
  if (mention.skillId) {
    const skill = skills.find((item) => item.skillId === mention.skillId);
    if (!skill) return false;
    return skillTerms(skill).some((term) => mentionsTerm(sentence, term));
  }
  return mentionsTerm(sentence, mention.term);
}

export function aliasDigest(skills: Skill[]): string {
  const view = [...skills]
    .sort((left, right) => left.skillId.localeCompare(right.skillId))
    .map((skill) => ({
      skillId: skill.skillId,
      canonical: skill.canonical,
      aliases: skill.aliases.filter((alias) => alias.approved).map((alias) => alias.alias).sort(),
    }));
  return digest(view);
}

// Represented role span (PLAN section 6): union of dated roles whose current approved facts link to the
// skill. It is a proposal about represented roles, not total experience and not measured tool usage.
export interface RoleSpan {
  skillId: string;
  months: number;
  asOf: string | null;
  roleVersionIds: string[];
  attestedMonths: number | null; // only approved duration assertion or usage intervals count toward years
}

export function representedRoleSpan(profile: Profile, skillId: string, asOf: string): RoleSpan {
  const asOfIndex = parseMonth(asOf);
  const ranges: Array<[number, number]> = [];
  const roleVersionIds = new Set<string>();
  let attested: number | null = null;
  for (const link of profile.skillEvidence.filter((item) => item.skillId === skillId)) {
    const fact = currentFactVersion(profile.facts, link.factId);
    if (!fact || fact.versionId !== link.factVersionId) continue;
    if (link.attestedMonths !== null && link.attestedMonths >= 0) {
      attested = Math.max(attested ?? 0, link.attestedMonths);
    }
    if (link.usage.length > 0) {
      const usageRanges: Array<[number, number]> = [];
      for (const interval of link.usage) {
        const start = parseMonth(interval.start);
        const end = parseMonth(interval.end);
        if (start !== null && end !== null && end >= start) usageRanges.push([start, end]);
      }
      const usageMonths = unionMonths(usageRanges);
      attested = Math.max(attested ?? 0, usageMonths);
    }
    if (!fact.roleRef) continue;
    const role = findRoleVersion(profile, fact.roleRef);
    if (!role || role.status !== "approved") continue;
    const start = parseMonth(role.start);
    const end = role.current || role.end === null ? asOfIndex : parseMonth(role.end);
    if (start === null || end === null || end < start) continue;
    ranges.push([start, end]);
    roleVersionIds.add(role.versionId);
  }
  return {
    skillId,
    months: unionMonths(ranges),
    asOf: asOfIndex === null ? null : formatMonth(asOfIndex),
    roleVersionIds: [...roleVersionIds].sort(),
    attestedMonths: attested,
  };
}

// Inclusive month ranges; overlaps counted once.
export function unionMonths(ranges: Array<[number, number]>): number {
  const sorted = [...ranges].sort((left, right) => left[0] - right[0]);
  let total = 0;
  let current: [number, number] | null = null;
  for (const range of sorted) {
    if (!current || range[0] > current[1] + 1) {
      if (current) total += current[1] - current[0] + 1;
      current = [range[0], range[1]];
    } else {
      current[1] = Math.max(current[1], range[1]);
    }
  }
  if (current) total += current[1] - current[0] + 1;
  return total;
}

export function tenureDigest(profile: Profile): string {
  const view = [...profile.skillEvidence]
    .sort((left, right) =>
      `${left.skillId}/${left.factId}/${left.factVersionId}`.localeCompare(`${right.skillId}/${right.factId}/${right.factVersionId}`),
    )
    .map((link) => ({
      skillId: link.skillId,
      factVersionId: link.factVersionId,
      usage: link.usage,
      attestedMonths: link.attestedMonths,
    }));
  return digest(view);
}
