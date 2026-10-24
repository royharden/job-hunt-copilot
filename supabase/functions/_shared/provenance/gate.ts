import { findLexiconTerms } from "./lexicon.ts";
import { containsPhrase, letterCount, numericTokens, uniqueStrings } from "./normalize.ts";
import type { CoverLine, DraftBullet, Fact, GateLineResult, GateReport } from "./types.ts";

const CITE_RE = /\[\[fact:([A-Za-z0-9_-]+)\]\]/g;
const ORG_RE =
  /\b(?:at|with|for|from)\s+([A-Z][\p{L}\p{N}&.'’-]*(?:\s+[A-Z][\p{L}\p{N}&.'’-]*){0,4})/gu;
const TITLE_RE =
  /\b(?:as|titled)\s+(?:an?\s+|the\s+)?([A-Z][\p{L}\p{N}/&+-]*(?:\s+[A-Z][\p{L}\p{N}/&+-]*){0,5})/gu;
const ORG_STOP = new Set([
  "the",
  "a",
  "an",
  "our",
  "their",
  "this",
  "that",
  "my",
  "team",
  "and",
  "for",
  "with",
  "from",
]);

export interface ClaimInput {
  text: string;
  factIds: string[];
  heading?: string;
}

function stripCitations(text: string): { text: string; inlineIds: string[] } {
  const inlineIds: string[] = [];
  const stripped = text.replace(CITE_RE, (_full, id: string) => {
    inlineIds.push(id);
    return " ";
  });
  return { text: stripped.replace(/\s+/g, " ").trim(), inlineIds };
}

function citedContains(facts: Fact[], phrase: string): boolean {
  return facts.some(
    (fact) => containsPhrase(fact.text, phrase) || containsPhrase(fact.surface, phrase),
  );
}

function keepPhrase(phrase: string): boolean {
  const words = phrase.trim().split(/\s+/);
  return words.some((word) => !ORG_STOP.has(word.toLowerCase()));
}

function collectPhrases(text: string, pattern: RegExp): string[] {
  const found: string[] = [];
  const re = new RegExp(pattern.source, pattern.flags);
  for (const match of text.matchAll(re)) {
    const phrase = match[1]?.trim();
    if (!phrase || !keepPhrase(phrase)) continue;
    found.push(phrase);
  }
  return uniqueStrings(found);
}

function claimReasons(text: string, cited: Fact[], profile: Fact[]): string[] {
  const reasons: string[] = [];
  const citedNumbers = new Set(cited.flatMap((fact) => numericTokens(fact.text).map((token) => token.core)));
  for (const token of numericTokens(text)) {
    if (!citedNumbers.has(token.core)) reasons.push(`invented_number:${token.raw}`);
  }
  for (const fact of profile) {
    if (fact.surface.trim().length < 2) continue;
    if (!containsPhrase(text, fact.surface)) continue;
    if (!citedContains(cited, fact.surface)) reasons.push(`uncited_surface:${fact.surface}`);
  }
  for (const term of findLexiconTerms(text)) {
    if (!citedContains(cited, term)) reasons.push(`unbacked_tool:${term}`);
  }
  for (const phrase of collectPhrases(text, ORG_RE)) {
    if (!citedContains(cited, phrase)) reasons.push(`unbacked_org:${phrase}`);
  }
  for (const phrase of collectPhrases(text, TITLE_RE)) {
    if (!citedContains(cited, phrase)) reasons.push(`unbacked_title:${phrase}`);
  }
  return uniqueStrings(reasons);
}

function restoreCitations(text: string, factIds: string[]): string {
  if (factIds.length === 0) return text;
  return `${text} ${factIds.map((id) => `[[fact:${id}]]`).join(" ")}`.trim();
}

export function gateClaim(input: ClaimInput, facts: Fact[], index: number): GateLineResult {
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const stripped = stripCitations(input.text);
  const factIds = uniqueStrings([...input.factIds, ...stripped.inlineIds]);
  const base = {
    index,
    originalText: input.text,
    factIds,
    heading: input.heading,
  };

  if (factIds.length === 0) {
    return { ...base, action: "drop", text: "", reasons: ["uncited"] };
  }
  const unknown = factIds.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    return {
      ...base,
      action: "drop",
      text: "",
      reasons: unknown.map((id) => `unknown_fact:${id}`),
    };
  }
  if (stripped.text.length === 0) {
    return { ...base, action: "drop", text: "", reasons: ["empty"] };
  }

  const cited = factIds.map((id) => byId.get(id)!);
  const reasons = claimReasons(stripped.text, cited, facts);
  if (reasons.length === 0) {
    return { ...base, action: "pass", text: input.text.trim(), reasons: [] };
  }

  const onlyNumbers = reasons.every((reason) => reason.startsWith("invented_number:"));
  if (onlyNumbers) {
    const raws = reasons.map((reason) => reason.slice("invented_number:".length));
    let reverted = stripped.text;
    for (const raw of raws) reverted = reverted.split(raw).join(" ");
    reverted = reverted.replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
    const retry = claimReasons(reverted, cited, facts);
    if (retry.length === 0 && letterCount(reverted) >= 12) {
      return {
        ...base,
        action: "revert",
        text: restoreCitations(reverted, factIds),
        reasons: [...reasons, "reverted_number"],
      };
    }
    return { ...base, action: "drop", text: "", reasons: [...reasons, "revert_failed"] };
  }

  return { ...base, action: "drop", text: "", reasons };
}

function summarize(lines: GateLineResult[]): Pick<GateReport, "passed" | "reverted" | "dropped"> {
  return {
    passed: lines.filter((line) => line.action === "pass").length,
    reverted: lines.filter((line) => line.action === "revert").length,
    dropped: lines.filter((line) => line.action === "drop").length,
  };
}

export function gateMaterials(
  input: { bullets: DraftBullet[]; cover: CoverLine[] },
  facts: Fact[],
): GateReport {
  const bullets = input.bullets.map((bullet, index) => gateClaim(bullet, facts, index));
  const cover = input.cover.map((line, index) =>
    gateClaim({ text: line.text, factIds: line.factIds, heading: line.heading }, facts, index),
  );
  return { bullets, cover, ...summarize([...bullets, ...cover]) };
}

export function isApprovable(report: GateReport): boolean {
  return (
    report.bullets.length > 0 &&
    report.bullets.every((line) => line.action === "pass") &&
    report.cover.every((line) => line.action === "pass")
  );
}

export function salvageDraft(report: GateReport): { bullets: DraftBullet[]; cover: CoverLine[] } {
  const bullets: DraftBullet[] = [];
  for (const line of report.bullets) {
    if (line.action === "drop" || line.text.trim().length === 0) continue;
    bullets.push({ text: line.text, factIds: line.factIds });
  }
  const cover: CoverLine[] = [];
  for (const line of report.cover) {
    if (line.action === "drop" || line.text.trim().length === 0) continue;
    cover.push({
      heading: line.heading && line.heading.trim().length > 0 ? line.heading : "Evidence",
      text: line.text,
      factIds: line.factIds,
    });
  }
  return { bullets, cover };
}
