import { sentenceSupportsTool, toolMentions } from "./aliases.ts";
import { blockingProblems, validateProfile } from "./health.ts";
import { containsPhrase, normalizeWhitespace, uniqueStrings } from "./normalize.ts";
import { numericMentions, sameQuantity, substantiveTokens, type NumericMention } from "./numbers.ts";
import { renderTemplate } from "./templates.ts";
import { findFactVersion, findRoleVersion, isCurrentFact, roleDates } from "./versions.ts";
import type {
  FactLine,
  FactRef,
  FactVersion,
  Finding,
  Grade,
  PacketLine,
  PacketRevision,
  PostingVersion,
  Profile,
  RenderedLine,
  SourceRef,
} from "./types.ts";

// Provenance guard (PLAN section 7).
// - verified: the line renders an exact approved current sentence (after whitespace normalization only) or a
//   finite template with typed current sources. Only verified lines are MVP-exportable.
// - unchecked: a free edit with no recognized unsupported claim. Not exportable in the MVP.
// - reverted: a recognized unsupported claim; the whole cited sentence is offered as a new revision.
// - blocked: unsupported/invalid sources or wording with no safe whole-sentence fallback.
// - checked: reserved for the optional, off-by-default M6 rewording path; never produced here.
// The checks below are finite heuristics for proposals, fixtures and the fabrication lab. They catch the
// listed patterns; they do not establish general semantic truth.

const ORG_RE = /\b(?:at|for|from|joined)\s+([A-Z][\p{L}\p{N}&.'’-]*(?:\s+[A-Z][\p{L}\p{N}&.'’-]*){0,4})/gu;
const TITLE_RE =
  /\b(?:as|titled|promoted to)\s+(?:an?\s+|the\s+)?([A-Z][\p{L}\p{N}/&+-]*(?:\s+[A-Z][\p{L}\p{N}/&+-]*){0,5})/gu;
const PHRASE_STOP = new Set(["the", "a", "an", "our", "their", "this", "that", "my", "and", "i", "we"]);

const ESCALATION_VERBS = [
  "led",
  "lead",
  "leading",
  "owned",
  "managed",
  "directed",
  "headed",
  "spearheaded",
  "architected",
  "founded",
  "authored",
  "invented",
  "oversaw",
  "supervised",
  "drove",
  "championed",
];
const QUALIFIERS = ["contributed to", "helped", "assisted", "supported", "participated in", "as part of", "co-", "alongside"];
const DOWN_WORDS = ["reduced", "cut", "decreased", "lowered", "shrank", "saved", "eliminated"];
const UP_WORDS = ["increased", "raised", "grew", "boosted", "expanded", "doubled", "tripled"];
const NEGATIONS = /\b(not|never|no|without|didn['’]t|did not|wasn['’]t|non-)\b/i;

function collectPhrases(text: string, pattern: RegExp): string[] {
  const found: string[] = [];
  const re = new RegExp(pattern.source, pattern.flags);
  for (const match of text.matchAll(re)) {
    const phrase = match[1]?.trim().replace(/[.,;:]+$/u, "");
    if (!phrase) continue;
    if (phrase.split(/\s+/).every((word) => PHRASE_STOP.has(word.toLowerCase()))) continue;
    found.push(phrase);
  }
  return uniqueStrings(found);
}

function hasWord(text: string, word: string): boolean {
  return new RegExp(`(?<![\\p{L}])${word.replace(/[-]/g, "\\-")}`, "iu").test(text);
}

interface CitedContext {
  fact: FactVersion;
  roleText: string; // employer/title/dates of the referenced role, for org/title/year checks
}

function citedContexts(facts: FactVersion[], profile: Profile): CitedContext[] {
  return facts.map((fact) => {
    const role = fact.roleRef ? findRoleVersion(profile, fact.roleRef) : null;
    return { fact, roleText: role ? `${role.title} | ${role.employer} | ${roleDates(role)}` : "" };
  });
}

function numberFindings(text: string, cited: CitedContext[]): Finding[] {
  const findings: Finding[] = [];
  const mentions = numericMentions(text);
  if (mentions.length === 0) return findings;
  const perFact = cited.map((item) => ({
    item,
    mentions: [...numericMentions(item.fact.text), ...numericMentions(item.roleText)],
  }));
  const supports = (fact: (typeof perFact)[number], mention: NumericMention) =>
    fact.mentions.some((candidate) => sameQuantity(candidate, mention)) ||
    (mention.ambiguous && containsPhrase(fact.item.fact.text, mention.raw));

  for (const mention of mentions) {
    if (perFact.some((fact) => supports(fact, mention))) continue;
    if (mention.ambiguous) {
      findings.push({ code: "ambiguous_number", detail: `"${mention.raw}" is an ambiguous quantity not stated in the cited sentence.` });
      continue;
    }
    const sameValue = perFact.flatMap((fact) => fact.mentions).find((candidate) => Math.abs(candidate.value - mention.value) < 1e-9);
    if (sameValue) {
      findings.push({
        code: "unit_swap",
        detail: `"${mention.raw}" is ${mention.dimension}${mention.unit ? ` (${mention.unit})` : ""}; the source states ${sameValue.raw} as ${sameValue.dimension}${sameValue.unit ? ` (${sameValue.unit})` : ""}.`,
      });
    } else {
      findings.push({ code: "invented_number", detail: `"${mention.raw}" does not appear in the cited sentence.` });
    }
  }
  // No pooling: every quantity must come from one cited sentence.
  if (findings.length === 0 && perFact.length > 1 && !perFact.some((fact) => mentions.every((mention) => supports(fact, mention)))) {
    findings.push({ code: "pooled_numbers", detail: "Quantities come from different cited sentences; each line must take its numbers from one sentence." });
  }
  return findings;
}

export function guardProposal(text: string, factRefs: FactRef[], profile: Profile): Finding[] {
  const findings: Finding[] = [];
  const clean = normalizeWhitespace(text);
  if (clean.length === 0) return [{ code: "empty", detail: "The line is empty." }];
  if (factRefs.length === 0) return [{ code: "uncited", detail: "No approved sentence is cited." }];

  const facts: FactVersion[] = [];
  for (const ref of factRefs) {
    const fact = findFactVersion(profile, ref);
    if (!fact) {
      findings.push({ code: "phantom_ref", detail: `Fact version ${ref.versionId} is not in this profile.` });
    } else if (fact.status !== "approved") {
      findings.push({ code: "unapproved_ref", detail: `Fact version ${ref.versionId} is ${fact.status}.` });
    } else if (!isCurrentFact(profile, ref)) {
      findings.push({ code: "stale_ref", detail: `Fact version ${ref.versionId} has been superseded or withdrawn.` });
    } else if (fact.kind === "preference" && factRefs.length > 1) {
      findings.push({ code: "wrong_kind_ref", detail: "A preference statement cannot support a career claim alongside other evidence." });
    } else {
      facts.push(fact);
    }
  }
  if (findings.length > 0) return findings;

  const cited = citedContexts(facts, profile);
  const citedText = cited.map((item) => `${item.fact.text} ${item.roleText}`).join(" \n ");

  findings.push(...numberFindings(clean, cited));

  for (const token of substantiveTokens(clean)) {
    if (!citedText.toLowerCase().includes(token)) {
      findings.push({ code: "unsupported_addition", detail: `"${token}" is not stated in the cited sentence.` });
    }
  }

  for (const mention of toolMentions(clean, profile.skills)) {
    if (!cited.some((item) => sentenceSupportsTool(item.fact.text, mention, profile.skills))) {
      findings.push({ code: "unbacked_tool", detail: `${mention.term} is not named by the cited sentence or an approved alias.` });
    }
  }

  for (const phrase of collectPhrases(clean, ORG_RE)) {
    if (!containsPhrase(citedText, phrase)) {
      findings.push({ code: "unbacked_org", detail: `"${phrase}" is not the cited employer or organisation.` });
    }
  }
  for (const phrase of collectPhrases(clean, TITLE_RE)) {
    if (!cited.some((item) => item.roleText.includes(phrase) || item.fact.text.includes(phrase))) {
      findings.push({ code: "unbacked_title", detail: `"${phrase}" is not the cited title.` });
    }
  }

  for (const verb of ESCALATION_VERBS) {
    if (hasWord(clean, `${verb}\\b`) && !cited.some((item) => hasWord(item.fact.text, `${verb}\\b`))) {
      findings.push({ code: "verb_escalation", detail: `"${verb}" claims more authorship or ownership than the cited sentence.` });
      break;
    }
  }
  for (const qualifier of QUALIFIERS) {
    const inSource = cited.some((item) => item.fact.text.toLowerCase().includes(qualifier));
    if (inSource && !clean.toLowerCase().includes(qualifier)) {
      findings.push({ code: "scope_change", detail: `The cited sentence says "${qualifier}"; the line drops that qualifier.` });
      break;
    }
  }
  // Relation/direction changes with otherwise high word overlap ("reduced" -> "increased").
  const direction = (value: string) => ({
    down: DOWN_WORDS.some((word) => hasWord(value, `${word}\\b`)),
    up: UP_WORDS.some((word) => hasWord(value, `${word}\\b`)),
  });
  const lineDirection = direction(clean);
  const sourceDirection = cited.map((item) => direction(item.fact.text));
  if (
    (lineDirection.up && !sourceDirection.some((item) => item.up) && sourceDirection.some((item) => item.down)) ||
    (lineDirection.down && !sourceDirection.some((item) => item.down) && sourceDirection.some((item) => item.up))
  ) {
    findings.push({ code: "direction_change", detail: "The line reverses the direction of change stated in the cited sentence." });
  }
  const sourceNegated = cited.some((item) => NEGATIONS.test(item.fact.text));
  if (sourceNegated !== NEGATIONS.test(clean)) {
    findings.push({ code: "polarity_change", detail: "Negation differs between the line and the cited sentence." });
  }

  // Wrong-project metrics: a project named in the line must be the project of the cited sentence.
  const projectLabels = uniqueStrings(
    profile.facts.map((fact) => fact.projectLabel).filter((label): label is string => Boolean(label && label.trim())),
  );
  for (const label of projectLabels) {
    if (!containsPhrase(clean, label)) continue;
    if (!cited.some((item) => item.fact.projectLabel === label || containsPhrase(item.fact.text, label))) {
      findings.push({ code: "wrong_project", detail: `"${label}" is a different project from the cited sentence.` });
    }
  }

  return findings;
}

function factSource(fact: FactVersion): SourceRef {
  const quote = fact.origin.type === "source_span" ? fact.origin.quote : fact.origin.statement;
  return { kind: "fact", id: fact.factId, versionId: fact.versionId, quote };
}

export function renderFactLine(line: FactLine, profile: Profile): RenderedLine {
  const base = {
    lineId: line.lineId,
    section: line.section,
    proposalText: line.proposalText,
    requirementIds: line.requirementIds,
  };
  const fact = findFactVersion(profile, line.fact);
  if (!fact || fact.status !== "approved" || !isCurrentFact(profile, line.fact)) {
    const findings = guardProposal(line.proposalText, [line.fact], profile);
    return { ...base, text: "", grade: "blocked", findings, sources: [], fallback: null };
  }
  const sources = [factSource(fact)];
  const approved = normalizeWhitespace(fact.text);
  if (normalizeWhitespace(line.proposalText) === approved) {
    return { ...base, text: approved, grade: "verified", findings: [], sources, fallback: null };
  }
  const findings = guardProposal(line.proposalText, [line.fact], profile);
  const fallback = { text: approved, fact: { factId: fact.factId, versionId: fact.versionId } };
  if (findings.length > 0) {
    return { ...base, text: "", grade: "reverted", findings, sources, fallback };
  }
  return {
    ...base,
    text: "",
    grade: "unchecked",
    findings: [{ code: "free_edit", detail: "Edited wording is not an approved sentence. The MVP exports approved sentences only." }],
    sources,
    fallback,
  };
}

export interface GateContext {
  profile: Profile;
  posting: PostingVersion;
}

export function renderLine(line: PacketLine, context: GateContext): RenderedLine {
  if (line.kind === "fact") return renderFactLine(line, context.profile);
  const rendered = renderTemplate(line, context.profile, context.posting);
  const base = {
    lineId: line.lineId,
    section: line.section,
    proposalText: line.proposalText,
    requirementIds: line.requirementIds,
  };
  if (rendered.text === null) {
    return { ...base, text: "", grade: "blocked", findings: rendered.findings, sources: rendered.sources, fallback: null };
  }
  if (normalizeWhitespace(line.proposalText) !== rendered.text) {
    return {
      ...base,
      text: "",
      grade: "blocked",
      findings: [{ code: "template_edited", detail: "Template wording was edited. Reset it to the fixed template." }],
      sources: rendered.sources,
      fallback: { text: rendered.text, fact: null },
    };
  }
  return { ...base, text: rendered.text, grade: "verified", findings: [], sources: rendered.sources, fallback: null };
}

export interface GateResult {
  lines: RenderedLine[];
  renderedText: string; // exact bytes bound by approval (UTF-8 of this string)
  counts: Record<Grade, number>;
  approvable: boolean;
  refusal: string | null;
}

// Health of the selected graph (PLAN sections 5-7): a line whose own fact version, or whose role header's
// role, has a health problem (bad span, wrong-kind or dangling role, withdrawn role, bad dates) is blocked.
function healthFindings(line: PacketLine, report: ReturnType<typeof validateProfile>): Finding[] {
  const ids =
    line.kind === "fact"
      ? blockingProblems(report, [line.fact])
      : line.role
        ? blockingProblems(report, [], [line.role.roleId, line.role.roleVersionId])
        : [];
  return ids.map((problem) => ({ code: `health_${problem.code}`, detail: problem.reason }));
}

export function gatePacket(revision: Pick<PacketRevision, "lines">, context: GateContext): GateResult {
  const report = validateProfile(context.profile);
  const lines = revision.lines.map((line) => {
    const rendered = renderLine(line, context);
    const health = healthFindings(line, report);
    if (health.length === 0 || rendered.grade !== "verified") return rendered;
    return { ...rendered, text: "", grade: "blocked" as const, findings: health, fallback: null };
  });
  const counts: Record<Grade, number> = { verified: 0, unchecked: 0, blocked: 0, reverted: 0, checked: 0 };
  for (const line of lines) counts[line.grade] += 1;
  const factLines = revision.lines.filter((line) => line.kind === "fact").length;
  let refusal: string | null = null;
  if (lines.length === 0 || factLines === 0) refusal = "A packet needs at least one approved evidence sentence.";
  else if (counts.verified !== lines.length) refusal = "Every line must be verified. Remove or replace the flagged lines first.";
  return {
    lines,
    renderedText: lines.map((line) => line.text).join("\n"),
    counts,
    approvable: refusal === null,
    refusal,
  };
}

export function isApprovable(result: GateResult): boolean {
  return result.approvable;
}

const SECTION_TITLES: Record<string, string> = {
  opening: "Opening",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  closing: "Closing",
};

// Exports derive deterministically from verified lines only.
export function exportPacket(lines: RenderedLine[]): { plainText: string; markdown: string } {
  const verified = lines.filter((line) => line.grade === "verified");
  const plainText = verified.map((line) => line.text).join("\n");
  const markdown: string[] = [];
  let section = "";
  for (const line of verified) {
    if (line.section !== section) {
      section = line.section;
      if (markdown.length > 0) markdown.push("");
      markdown.push(`## ${SECTION_TITLES[section] ?? section}`);
    }
    const isBullet = line.section === "experience" && line.sources.some((source) => source.kind === "fact");
    markdown.push(isBullet ? `- ${line.text}` : line.text);
  }
  return { plainText, markdown: markdown.join("\n") };
}
