import { LIMITS } from "./limits.ts";
import { TEMPLATE_TEXT } from "./templates.ts";
import { currentRoleVersion, findFactVersion, isCurrentFact, roleDates } from "./versions.ts";
import type {
  FactLine,
  PacketLine,
  PacketSection,
  PostingVersion,
  Profile,
  RequirementEvidence,
  TemplateLine,
} from "./types.ts";

// Keyless assembly (PLAN section 1): select, prioritize and group approved sentences plus fixed templates.
// No wording is generated. Lines for gaps or unconfirmed requirements are never added.

const FACT_SECTION: Record<string, PacketSection> = {
  education: "education",
  credential: "education",
  skill_usage: "skills",
};

export function assemblePacket(
  evidence: RequirementEvidence[],
  profile: Profile,
  posting: PostingVersion,
  newLineId: () => string,
): PacketLine[] {
  // Fact version -> requirement ids it confirmed (direct first, then partial).
  const order: string[] = [];
  const requirementsByFact = new Map<string, { factId: string; versionId: string; requirementIds: string[]; direct: boolean }>();
  for (const item of evidence) {
    const confirmed = item.confirmed;
    if (!confirmed || confirmed.tier === "gap") continue;
    for (const ref of confirmed.facts) {
      if (!isCurrentFact(profile, ref)) continue;
      const existing = requirementsByFact.get(ref.versionId);
      if (existing) {
        existing.requirementIds.push(item.requirementId);
        existing.direct = existing.direct || confirmed.tier === "direct";
      } else {
        requirementsByFact.set(ref.versionId, {
          factId: ref.factId,
          versionId: ref.versionId,
          requirementIds: [item.requirementId],
          direct: confirmed.tier === "direct",
        });
        order.push(ref.versionId);
      }
    }
  }
  const selected = order
    .map((versionId) => requirementsByFact.get(versionId)!)
    .sort((left, right) => Number(right.direct) - Number(left.direct) || right.requirementIds.length - left.requirementIds.length);

  const lines: PacketLine[] = [];
  const opening: TemplateLine = {
    lineId: newLineId(),
    section: "opening",
    kind: "template",
    templateId: "application_opening",
    role: null,
    proposalText: TEMPLATE_TEXT.application_opening
      .replace("{title}", posting.title.trim())
      .replace("{organisation}", posting.organisation.trim()),
    requirementIds: [],
  };
  lines.push(opening);

  // Group experience lines under one role header per role.
  const byRole = new Map<string, FactLine[]>();
  const other: FactLine[] = [];
  for (const item of selected) {
    const fact = findFactVersion(profile, { factId: item.factId, versionId: item.versionId });
    if (!fact) continue;
    const factLine: FactLine = {
      lineId: newLineId(),
      section: FACT_SECTION[fact.kind] ?? "experience",
      kind: "fact",
      fact: { factId: fact.factId, versionId: fact.versionId },
      proposalText: fact.text,
      requirementIds: [...new Set(item.requirementIds)],
    };
    if (factLine.section === "experience" && fact.roleRef) {
      const role = currentRoleVersion(profile.roles, fact.roleRef.roleId);
      if (role && role.versionId === fact.roleRef.roleVersionId) {
        const key = role.roleId;
        byRole.set(key, [...(byRole.get(key) ?? []), factLine]);
        continue;
      }
    }
    other.push(factLine);
  }

  for (const [roleId, factLines] of byRole) {
    const role = currentRoleVersion(profile.roles, roleId)!;
    lines.push({
      lineId: newLineId(),
      section: "experience",
      kind: "template",
      templateId: "role_header",
      role: { roleId: role.roleId, roleVersionId: role.versionId },
      proposalText: TEMPLATE_TEXT.role_header
        .replace("{title}", role.title)
        .replace("{employer}", role.employer)
        .replace("{dates}", roleDates(role)),
      requirementIds: [],
    });
    lines.push(...factLines);
  }
  const sectionRank: Record<PacketSection, number> = { opening: 0, experience: 1, education: 2, skills: 3, closing: 4 };
  lines.push(...other.sort((left, right) => sectionRank[left.section] - sectionRank[right.section]));

  // Truncate evidence lines, never the fixed closing.
  lines.splice(LIMITS.packetLines - 1);
  lines.push({
    lineId: newLineId(),
    section: "closing",
    kind: "template",
    templateId: "generic_closing",
    role: null,
    proposalText: TEMPLATE_TEXT.generic_closing,
    requirementIds: [],
  });
  return lines;
}

// Packet edits always produce a new revision; these helpers return new line arrays and never mutate.
export function removeLine(lines: PacketLine[], lineId: string): PacketLine[] {
  return lines.filter((line) => line.lineId !== lineId);
}

export function moveLine(lines: PacketLine[], lineId: string, delta: -1 | 1): PacketLine[] {
  const index = lines.findIndex((line) => line.lineId === lineId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= lines.length) return lines;
  const next = [...lines];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function replaceLineText(lines: PacketLine[], lineId: string, text: string): PacketLine[] {
  return lines.map((line) => (line.lineId === lineId ? { ...line, proposalText: text } : line));
}

// Accepting a whole-sentence fallback re-points the line at the cited current fact version and its exact text.
export function acceptFallback(lines: PacketLine[], lineId: string, fallback: { text: string; fact: { factId: string; versionId: string } | null }): PacketLine[] {
  return lines.map((line) => {
    if (line.lineId !== lineId) return line;
    if (line.kind === "fact" && fallback.fact) return { ...line, fact: fallback.fact, proposalText: fallback.text };
    return { ...line, proposalText: fallback.text };
  });
}
