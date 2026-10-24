// Numeric mentions with a value and a dimension, so the guard can tell 40 people from 40 percent.
// Finite, documented formats only (PLAN section 7). Anything else is reported as ambiguous.

export type Dimension = "percent" | "currency" | "people" | "duration" | "multiplier" | "year" | "count";

export interface NumericMention {
  raw: string;
  value: number;
  dimension: Dimension;
  unit: string | null; // currency symbol, duration unit, or the counted noun when known
  ambiguous: boolean;
  start: number;
  end: number;
}

const NUMBER_RE =
  /(?<![\p{L}\p{N}.])([$€£])?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(\+)?(?:\s?(%|percent\b|k\b|K\b|M\b|mm\b|MM\b|bn\b|B\b|million\b|billion\b|thousand\b|x\b|×))?(?![\p{L}\p{N}])/gu;

const MAGNITUDE: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  m: 1_000_000,
  mm: 1_000_000,
  million: 1_000_000,
  bn: 1_000_000_000,
  b: 1_000_000_000,
  billion: 1_000_000_000,
};

const PEOPLE = new Set([
  "people",
  "person",
  "users",
  "user",
  "agents",
  "agent",
  "engineers",
  "engineer",
  "customers",
  "customer",
  "employees",
  "employee",
  "members",
  "member",
  "developers",
  "developer",
  "staff",
  "reports",
  "students",
  "student",
  "clients",
  "client",
  "volunteers",
  "interns",
  "analysts",
  "designers",
  "hires",
]);

const DURATION = new Map<string, string>([
  ["second", "second"],
  ["seconds", "second"],
  ["minute", "minute"],
  ["minutes", "minute"],
  ["min", "minute"],
  ["mins", "minute"],
  ["hour", "hour"],
  ["hours", "hour"],
  ["hrs", "hour"],
  ["day", "day"],
  ["days", "day"],
  ["week", "week"],
  ["weeks", "week"],
  ["month", "month"],
  ["months", "month"],
  ["year", "year"],
  ["years", "year"],
  ["ms", "millisecond"],
]);

function followingWords(text: string, from: number, count: number): string[] {
  const rest = text.slice(from, from + 80);
  return (rest.match(/\p{L}+/gu) ?? []).slice(0, count).map((word) => word.toLowerCase());
}

export function numericMentions(text: string): NumericMention[] {
  const found: NumericMention[] = [];
  const re = new RegExp(NUMBER_RE.source, NUMBER_RE.flags);
  for (const match of text.matchAll(re)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const end = start + raw.length;
    const currency = match[1] ?? null;
    const whole = match[2].replace(/,/g, "");
    const frac = match[3] ?? "";
    const plus = Boolean(match[4]);
    const suffix = match[5] ?? null;
    let value = Number(frac.length > 0 ? `${whole}.${frac}` : whole);
    let dimension: Dimension = "count";
    let unit: string | null = null;
    let ambiguous = plus;

    const before = text.slice(Math.max(0, start - 2), start);
    const after = text.slice(end, end + 3);
    if (/[-–]\s*$/u.test(before) || /^\s*[-–/]\s*\d/u.test(after)) ambiguous = true;

    if (suffix === "%" || suffix === "percent") {
      dimension = "percent";
    } else if (suffix === "x" || suffix === "×") {
      dimension = "multiplier";
    } else if (suffix) {
      const factor = MAGNITUDE[suffix.toLowerCase()];
      if (factor) value *= factor;
    }

    if (currency) {
      dimension = "currency";
      unit = currency;
    } else if (dimension === "count") {
      const words = followingWords(text, end, 3);
      const durationWord = words.find((word) => DURATION.has(word));
      const peopleWord = words.slice(0, 3).find((word) => PEOPLE.has(word));
      if (words.length > 0 && DURATION.has(words[0])) {
        dimension = "duration";
        unit = DURATION.get(words[0]) ?? null;
      } else if (peopleWord) {
        dimension = "people";
        unit = "people";
      } else if (!suffix && frac.length === 0 && /^(?:19|20)\d{2}$/.test(whole)) {
        dimension = "year";
      } else if (durationWord && words.indexOf(durationWord) === 0) {
        dimension = "duration";
      } else {
        unit = words[0] ?? null;
      }
    }

    found.push({ raw, value, dimension, unit, ambiguous, start, end });
  }
  return found;
}

// Same value and dimension (and unit for durations/currency). Counts also need the same counted noun when
// both sides name one, so "12 services" does not support "12 regions".
export function sameQuantity(left: NumericMention, right: NumericMention): boolean {
  if (left.dimension !== right.dimension) return false;
  if (Math.abs(left.value - right.value) > 1e-9) return false;
  if (left.dimension === "duration" || left.dimension === "currency") return left.unit === right.unit;
  if (left.dimension === "count" && left.unit && right.unit) return left.unit === right.unit;
  return true;
}

// Version, percentile, quarter and always-on tokens are substantive additions, not free decoration.
const SUBSTANTIVE_RE = /(?<![\p{L}\p{N}])(?:p\d{2,3}|q[1-4]|v\d+(?:\.\d+)*|fy\d{2,4}|24\/7|99\.\d+%?)(?![\p{L}\p{N}])/giu;

export function substantiveTokens(text: string): string[] {
  const re = new RegExp(SUBSTANTIVE_RE.source, SUBSTANTIVE_RE.flags);
  return [...text.matchAll(re)].map((match) => match[0].toLowerCase());
}
