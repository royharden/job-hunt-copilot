import { REVIEW_THRESHOLD } from "./limits.ts";
import type { Classification, ReplyLabel } from "./types.ts";

interface Phrase {
  label: Exclude<ReplyLabel, "unknown">;
  phrase: string;
  weight: number;
}

const PHRASES: Phrase[] = [
  { label: "rejected", phrase: "we regret", weight: 2 },
  { label: "rejected", phrase: "not moving forward", weight: 2 },
  { label: "rejected", phrase: "position has been filled", weight: 2 },
  { label: "rejected", phrase: "will not be proceeding", weight: 2 },
  { label: "rejected", phrase: "other candidates", weight: 1 },
  { label: "rejected", phrase: "unfortunately we", weight: 1 },
  { label: "offer", phrase: "pleased to offer", weight: 2 },
  { label: "offer", phrase: "offer of employment", weight: 2 },
  { label: "offer", phrase: "compensation package", weight: 1 },
  { label: "interview", phrase: "invite you to interview", weight: 2 },
  { label: "interview", phrase: "schedule a call", weight: 2 },
  { label: "interview", phrase: "phone screen", weight: 2 },
  { label: "interview", phrase: "interview", weight: 1 },
  { label: "acknowledgement", phrase: "we have received your application", weight: 2 },
  { label: "acknowledgement", phrase: "thank you for applying", weight: 2 },
  { label: "acknowledgement", phrase: "application received", weight: 2 },
  { label: "not_applicable", phrase: "your order has shipped", weight: 2 },
  { label: "not_applicable", phrase: "password reset", weight: 2 },
  { label: "not_applicable", phrase: "unsubscribe", weight: 2 },
];

const PRIORITY: ReplyLabel[] = [
  "offer",
  "interview",
  "rejected",
  "acknowledgement",
  "not_applicable",
  "unknown",
];

function isBoundary(char: string | undefined): boolean {
  if (!char) return true;
  return !/[\p{L}\p{N}]/u.test(char);
}

export function classifyReply(text: string): Classification {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return { label: "unknown", confidence: 0.2, needsReview: true, hits: [] };
  }

  const consumed: Array<[number, number]> = [];
  const scores = new Map<Phrase["label"], number>();
  const hits: string[] = [];
  const ordered = [...PHRASES].sort((left, right) => right.phrase.length - left.phrase.length);

  for (const entry of ordered) {
    const needle = entry.phrase.toLowerCase();
    let from = 0;
    while (from < normalized.length) {
      const at = normalized.indexOf(needle, from);
      if (at < 0) break;
      const end = at + needle.length;
      const overlaps = consumed.some(([start, stop]) => at < stop && end > start);
      if (!overlaps && isBoundary(normalized[at - 1]) && isBoundary(normalized[end])) {
        consumed.push([at, end]);
        scores.set(entry.label, (scores.get(entry.label) ?? 0) + entry.weight);
        hits.push(entry.phrase);
      }
      from = end;
    }
  }

  const ranked = [...scores.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return PRIORITY.indexOf(left[0]) - PRIORITY.indexOf(right[0]);
  });
  if (ranked.length === 0) {
    return { label: "unknown", confidence: 0.2, needsReview: true, hits };
  }

  const [label, score] = ranked[0];
  const competing = ranked.length > 1 && ranked[1][1] / score > 0.5;
  if (competing) {
    return { label, confidence: 0.45, needsReview: true, hits };
  }
  const confidence = score >= 2 ? 0.92 : 0.72;
  return {
    label,
    confidence,
    needsReview: confidence < REVIEW_THRESHOLD,
    hits,
  };
}
