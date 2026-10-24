const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "you",
  "your",
  "our",
  "are",
  "was",
  "were",
  "this",
  "that",
  "from",
  "have",
  "has",
  "will",
  "not",
  "but",
  "can",
  "all",
  "any",
  "who",
  "what",
  "when",
  "where",
  "which",
  "into",
  "about",
  "over",
  "than",
  "then",
  "them",
  "they",
  "their",
  "been",
  "being",
  "such",
  "using",
  "use",
  "used",
  "per",
  "via",
  "including",
  "include",
  "must",
  "should",
  "required",
  "requirement",
  "requirements",
  "experience",
  "experienced",
  "years",
  "year",
  "ability",
  "able",
  "strong",
  "plus",
  "role",
  "job",
  "work",
  "working",
  "team",
  "teams",
  "eligibility",
  "eligible",
  "qualification",
  "qualifications",
  "proficient",
]);

const NUMBER_RE =
  /(?<![\p{L}])\$?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?(?![\p{L}])|(?<![\p{L}])\$?\d+(?:\.\d+)?%?(?![\p{L}])/gu;

export interface NumericToken {
  raw: string;
  core: string;
}

export function significantTokens(text: string): string[] {
  const parts = text.match(/[\p{L}\p{N}][\p{L}\p{N}.+#-]*/gu) ?? [];
  const out: string[] = [];
  for (const part of parts) {
    const token = part.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.+#]+$/gu, "");
    if (token.length <= 2 || STOPWORDS.has(token) || /^\d+(?:\.\d+)?$/.test(token)) {
      continue;
    }
    out.push(token);
  }
  return out;
}

export function numericTokens(text: string): NumericToken[] {
  const found: NumericToken[] = [];
  const re = new RegExp(NUMBER_RE.source, NUMBER_RE.flags);
  for (const match of text.matchAll(re)) {
    const raw = match[0];
    found.push({ raw, core: digitCore(raw) });
  }
  return found;
}

export function digitCore(raw: string): string {
  const stripped = raw.replace(/[$,%]/g, "").replace(/,/g, "");
  const [whole, frac = ""] = stripped.split(".");
  const trimmedFrac = frac.replace(/0+$/, "");
  return trimmedFrac.length > 0 ? `${whole}.${trimmedFrac}` : whole;
}

export function containsPhrase(haystack: string, phrase: string): boolean {
  const trimmed = phrase.trim();
  if (trimmed.length === 0) return false;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
  return re.test(haystack);
}

export function letterCount(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).length;
}

export function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
