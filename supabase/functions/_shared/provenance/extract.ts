import { findLexiconTerms } from "./lexicon.ts";
import { LIMITS } from "./limits.ts";
import { normalizeWhitespace, significantTokens } from "./normalize.ts";
import type { Priority, QuoteSpan, RequirementFlag } from "./types.ts";

// Deterministic requirement proposals from a pasted posting. The user reviews, splits, edits, removes and
// prioritizes every one; nothing here is final. Quote offsets are UTF-16 code units into the posting body.

export interface ExtractedRequirement {
  quote: QuoteSpan;
  clause: string;
  priority: Priority;
  flags: RequirementFlag[];
}

const BULLET_RE = /^(\s*(?:[-*•▪◦]|\d+[.)])\s+)(.+?)\s*$/u;
const SIGNAL_RE =
  /\b(required|requirements|must|experience (?:with|in)|proficien\w*|knowledge of|familiarity with|degree|certif\w*|years?)\b/i;
const PREFERRED_HEADING_RE = /\b(preferred|nice to have|nice-to-have|bonus|pluses|desired|good to have)\b/i;
const REQUIRED_HEADING_RE = /\b(requirements|required|qualifications|must have|what you(?:'|’)ll need|you have)\b/i;
const BENEFIT_HEADING_RE = /\b(benefits|perks|what we offer|compensation|why join)\b/i;
const OTHER_HEADING_RE = /\b(about us|about the role|responsibilities|what you(?:'|’)ll do|the role|how to apply)\b/i;
const BENEFIT_RE =
  /\b(health|dental|vision|insurance|401\(?k\)?|pto|paid time off|vacation|equity|stock options|stipend|parental leave|salary|bonus program|wellness)\b/i;

function headingKind(line: string): "required" | "preferred" | "benefit" | "other" | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 60 || BULLET_RE.test(line)) return null;
  // A heading either ends with ":" / starts with "#", or is nothing but a heading phrase ("Benefits").
  // "Must have Python" or "5+ years required" stay requirements.
  const marked = /:\s*$/.test(trimmed) || /^#+\s/.test(trimmed);
  const bare = trimmed.replace(/^#+\s*/, "").replace(/[:\s]+$/, "");
  const test = (re: RegExp) => (marked ? re.test(trimmed) : new RegExp(`^(?:${re.source})$`, "i").test(bare));
  if (test(BENEFIT_HEADING_RE)) return "benefit";
  if (test(PREFERRED_HEADING_RE)) return "preferred";
  if (test(REQUIRED_HEADING_RE)) return "required";
  if (test(OTHER_HEADING_RE)) return "other";
  return null;
}

export function requirementFlags(clause: string, inBenefits: boolean): RequirementFlag[] {
  const flags: RequirementFlag[] = [];
  if (/\b\d+\s*\+?\s*(?:-|to)?\s*\d*\s*\+?\s*years?\b/i.test(clause) || /\byears? of\b/i.test(clause)) flags.push("years");
  if (/\b(degree|bachelor(?:'|’)?s?|master(?:'|’)?s?|ph\.?d|b\.?s\.?|m\.?s\.?|certif\w*|licen[cs]e\w*|clearance)\b/i.test(clause)) {
    flags.push("credential");
  }
  if (/\b(no|not|never|without|non-)\b/i.test(clause)) flags.push("negation");
  if (/\b(if|unless|when|willing to|able to|must be located|authori[sz]ed to work|on-?site|relocat\w*|travel)\b/i.test(clause)) {
    flags.push("condition");
  }
  if (inBenefits || BENEFIT_RE.test(clause)) flags.push("benefit");
  if (/\b(expert|advanced|proficien\w*|fluent|deep|strong|senior-level|mastery)\b/i.test(clause)) flags.push("proficiency");
  const tools = findLexiconTerms(clause);
  if (tools.length >= 2 || /;/.test(clause) || (/\band\b/i.test(clause) && tools.length >= 1 && significantTokens(clause).length >= 4)) {
    flags.push("mixed");
  }
  return flags;
}

function worthKeeping(text: string): boolean {
  return significantTokens(text).length > 0 || (/\byears?\b/i.test(text) && /\d/.test(text));
}

export function extractRequirements(body: string): ExtractedRequirement[] {
  const found: ExtractedRequirement[] = [];
  const seen = new Set<string>();
  let section: "required" | "preferred" | "benefit" | "other" | null = null;
  let offset = 0;
  const lines = body.split("\n");
  for (const rawLine of lines) {
    const lineStart = offset;
    offset += rawLine.length + 1;
    const line = rawLine.replace(/\r$/, "");
    const heading = headingKind(line);
    if (heading) {
      section = heading;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.length > LIMITS.requirementChars) continue;
    const bullet = BULLET_RE.exec(line);
    let quoteStart: number;
    let quoteText: string;
    if (bullet) {
      quoteStart = lineStart + bullet[1].length;
      quoteText = bullet[2];
    } else if (SIGNAL_RE.test(trimmed) || section === "required" || section === "preferred") {
      quoteStart = lineStart + line.indexOf(trimmed);
      quoteText = trimmed;
    } else {
      continue;
    }
    if (section === "other" && !bullet && !SIGNAL_RE.test(trimmed)) continue;
    const clause = normalizeWhitespace(quoteText);
    if (!worthKeeping(clause)) continue;
    const key = clause.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const inBenefits = section === "benefit";
    const priority: Priority = section === "preferred" || PREFERRED_HEADING_RE.test(clause) ? "preferred" : "required";
    found.push({
      quote: { start: quoteStart, end: quoteStart + quoteText.length, text: quoteText },
      clause,
      priority,
      flags: requirementFlags(clause, inBenefits),
    });
    if (found.length >= LIMITS.requirementsPerPosting) break;
  }
  return found;
}

// Split a mixed clause into user-chosen parts. Each part keeps the original quote span for inspection
// (the edited clause is never highlighted as if it were the original text).
export function splitClause(clause: string, parts: string[]): string[] {
  const cleaned = parts.map((part) => normalizeWhitespace(part)).filter((part) => part.length > 0);
  return cleaned.length > 0 ? cleaned : [clause];
}

// Proposal for a split: "TypeScript and GraphQL" -> ["TypeScript", "GraphQL"]. The user can edit it.
export function proposeSplit(clause: string): string[] {
  const parts = clause
    .split(/\s*(?:;|,|\band\b|\/|\bor\b)\s*/i)
    .map((part) => normalizeWhitespace(part))
    .filter((part) => part.length > 0);
  return parts.length > 1 ? parts : [clause];
}
