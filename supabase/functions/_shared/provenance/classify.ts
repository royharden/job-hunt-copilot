import { REPLY_RULES_VERSION } from "./limits.ts";
import type { EvidenceStrength, ReplyLabel, ReplyPrediction, RuleHit } from "./types.ts";

// Pasted-reply rules (PLAN section 8). Output is a label, the rule IDs and phrase spans that fired, and a
// rule-evidence strength. There are no fixed probabilities. "strong" requires explicit evidence in the
// current (unquoted) message, the selected application named, and no conflicting or negated label.
// Everything else stays in review; the user's confirmation is what records a real-world event.

interface Rule {
  id: string;
  label: Exclude<ReplyLabel, "unknown">;
  strength: "strong" | "weak";
  pattern: RegExp;
}

const RULES: Rule[] = [
  { id: "rej.not_moving_forward", label: "rejection", strength: "strong", pattern: /\b(?:not|won['’]t) (?:be )?(?:moving|move) forward\b/gi },
  { id: "rej.not_proceeding", label: "rejection", strength: "strong", pattern: /\bwill not be proceeding\b/gi },
  { id: "rej.other_candidates_decision", label: "rejection", strength: "strong", pattern: /\bdecided to (?:pursue|move forward with|proceed with) other candidates\b/gi },
  { id: "rej.position_filled", label: "rejection", strength: "strong", pattern: /\bposition has been filled\b/gi },
  { id: "rej.regret_inform", label: "rejection", strength: "strong", pattern: /\bregret to inform\b/gi },
  { id: "rej.unable_to_offer", label: "rejection", strength: "strong", pattern: /\bunable to offer you\b/gi },
  { id: "rej.unfortunately", label: "rejection", strength: "weak", pattern: /\bunfortunately\b/gi },
  { id: "int.invite", label: "interview", strength: "strong", pattern: /\binvite you to (?:an? )?(?:interview|phone screen|onsite)\b/gi },
  { id: "int.schedule", label: "interview", strength: "strong", pattern: /\bschedule (?:a|an|your) (?:call|interview|phone screen|video call)\b/gi },
  { id: "int.next_round", label: "interview", strength: "strong", pattern: /\bnext round\b/gi },
  { id: "int.word", label: "interview", strength: "weak", pattern: /\binterview\w*\b/gi },
  { id: "off.pleased", label: "offer", strength: "strong", pattern: /\bpleased to (?:offer you|extend (?:you )?an offer)\b/gi },
  { id: "off.employment", label: "offer", strength: "strong", pattern: /\boffer of employment\b/gi },
  { id: "off.letter", label: "offer", strength: "weak", pattern: /\boffer letter\b/gi },
  { id: "off.word", label: "offer", strength: "weak", pattern: /\boffer\b/gi },
  { id: "ack.received", label: "acknowledgement", strength: "strong", pattern: /\b(?:we(?: have|['’]ve) )?received your application\b/gi },
  { id: "ack.thanks_applying", label: "acknowledgement", strength: "strong", pattern: /\bthank you for applying\b/gi },
  { id: "ack.in_touch", label: "acknowledgement", strength: "weak", pattern: /\b(?:we will|we['’]ll) be in touch\b/gi },
  { id: "ack.interest", label: "acknowledgement", strength: "weak", pattern: /\bthanks? (?:you )?for your interest\b/gi },
  { id: "na.unsubscribe", label: "not_applicable", strength: "strong", pattern: /\bunsubscribe\b/gi },
  { id: "na.newsletter", label: "not_applicable", strength: "strong", pattern: /\bnewsletter\b/gi },
  { id: "na.password", label: "not_applicable", strength: "strong", pattern: /\bpassword reset\b/gi },
  { id: "na.job_alert", label: "not_applicable", strength: "weak", pattern: /\b(?:job alert|recommended jobs|jobs you may like)\b/gi },
];

const NEGATION_BEFORE = /\b(?:not|no|never|isn['’]t|is not|wasn['’]t|without)\s+(?:an?\s+|the\s+|yet\s+)?$/i;
const OUTCOMES = new Set<ReplyLabel>(["rejection", "interview", "offer"]);
const CONTRAST = /\b(?:but|however|although|though|that said)\b/i;

interface Region {
  start: number;
  end: number;
  kind: "current" | "quoted" | "signature";
}

// Lines starting with ">" are quoted. Everything after an "On ... wrote:" line, an "Original Message" divider
// or a "From:" header line (after some content) is quoted. Everything after a "--" line is a signature.
// Stripping is heuristic; anything it marks quoted or signature can never produce strong evidence.
export function splitRegions(body: string): Region[] {
  const regions: Region[] = [];
  let offset = 0;
  let mode: Region["kind"] = "current";
  let sawContent = false;
  for (const rawLine of body.split("\n")) {
    const start = offset;
    const end = offset + rawLine.length;
    offset = end + 1;
    const line = rawLine.replace(/\r$/, "").trim();
    if (mode === "current") {
      if (/^--\s*$/.test(line)) mode = "signature";
      else if (/^On .+wrote:$/i.test(line) || /^-{2,}\s*original message/i.test(line) || (sawContent && /^from:\s/i.test(line))) {
        mode = "quoted";
      }
    }
    const kind: Region["kind"] = mode === "current" && line.startsWith(">") ? "quoted" : mode;
    if (line.length > 0) sawContent = true;
    regions.push({ start, end, kind });
  }
  return regions;
}

function regionAt(regions: Region[], index: number): Region["kind"] {
  return regions.find((region) => index >= region.start && index <= region.end)?.kind ?? "current";
}

export interface ReplyContext {
  organisation: string;
  title: string;
}

export function classifyReply(body: string, context: ReplyContext | null = null): ReplyPrediction {
  const regions = splitRegions(body);
  const hits: RuleHit[] = [];
  const taken: Array<[number, number]> = [];
  const strengthOf = new Map<string, Rule["strength"]>();
  // Strong rules first so a weak single word inside a strong phrase is not double counted.
  for (const rule of [...RULES].sort((left, right) => (left.strength === right.strength ? 0 : left.strength === "strong" ? -1 : 1))) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    for (const match of body.matchAll(re)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (taken.some(([from, to]) => start < to && end > from)) continue;
      taken.push([start, end]);
      const where = regionAt(regions, start);
      let ignored: string | null = null;
      if (where === "quoted") ignored = "quoted";
      else if (where === "signature") ignored = "signature";
      else if (NEGATION_BEFORE.test(body.slice(Math.max(0, start - 30), start))) ignored = "negated";
      hits.push({ ruleId: rule.id, label: rule.label, start, end, text: match[0], ignored });
      strengthOf.set(`${rule.id}`, rule.strength);
    }
  }
  hits.sort((left, right) => left.start - right.start);

  // Courtesy acknowledgement phrases ("Thank you for applying") inside an explicit outcome message do not
  // compete with that outcome.
  const outcomeStrong = hits.some(
    (hit) => hit.ignored === null && OUTCOMES.has(hit.label) && strengthOf.get(hit.ruleId) === "strong",
  );
  if (outcomeStrong) {
    for (const hit of hits) {
      if (hit.ignored === null && hit.label === "acknowledgement") hit.ignored = "courtesy";
    }
  }
  const counted = hits.filter((hit) => hit.ignored === null);
  const reasons: string[] = [];
  const currentText = regions
    .filter((region) => region.kind === "current")
    .map((region) => body.slice(region.start, region.end))
    .join("\n");

  if (hits.some((hit) => hit.ignored === "quoted")) reasons.push("Some phrases are in quoted earlier mail and do not count.");
  if (hits.some((hit) => hit.ignored === "negated")) reasons.push("A phrase is negated (for example 'not an offer').");

  if (counted.length === 0) {
    reasons.push(body.trim().length === 0 ? "Empty reply." : "No rule matched the current message.");
    return { label: "unknown", needsReview: true, strength: "none", hits, reasons, rulesVersion: REPLY_RULES_VERSION };
  }

  const labels = [...new Set(counted.map((hit) => hit.label))];
  const score = (label: ReplyLabel) =>
    counted.filter((hit) => hit.label === label).reduce((sum, hit) => sum + (strengthOf.get(hit.ruleId) === "strong" ? 2 : 1), 0);
  const ranked = [...labels].sort((left, right) => score(right) - score(left));
  const label = ranked[0];
  let strength: EvidenceStrength = counted.some((hit) => hit.label === label && strengthOf.get(hit.ruleId) === "strong") ? "strong" : "weak";

  if (labels.length > 1) {
    strength = "weak";
    reasons.push(`Conflicting labels: ${labels.join(", ")}.`);
  }
  if (CONTRAST.test(currentText) && (labels.length > 1 || hits.some((hit) => hit.ignored === "negated"))) {
    strength = "weak";
    reasons.push("Contrast wording ('but', 'however') next to a competing signal.");
  }
  if (hits.some((hit) => hit.ignored === "negated" && hit.label !== "not_applicable")) strength = "weak";
  if (label !== "not_applicable") {
    if (!context) {
      strength = "weak";
      reasons.push("No application selected, so the message cannot be tied to one.");
    } else {
      const named =
        (context.organisation.trim().length > 0 && currentText.toLowerCase().includes(context.organisation.trim().toLowerCase())) ||
        (context.title.trim().length > 0 && currentText.toLowerCase().includes(context.title.trim().toLowerCase()));
      if (!named) {
        strength = "weak";
        reasons.push("The current message does not name the selected application's organisation or title.");
      }
    }
  }
  if (strength === "strong") reasons.push("Explicit phrase in the current message, application named, no conflicting signal.");
  return { label, needsReview: strength !== "strong", strength, hits, reasons, rulesVersion: REPLY_RULES_VERSION };
}
