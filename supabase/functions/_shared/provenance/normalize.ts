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

// Short technology names that the length filter would otherwise drop. Matched case-sensitively on the
// original token so the English words "go", "c" or "r" are not mistaken for skills.
const SHORT_TECH = new Set(["C", "R", "Go", "AI", "ML", "UI", "UX", "QA", "C#", "C++", "F#", "JS", "TS", "BI"]);

export function significantTokens(text: string): string[] {
  const parts = text.match(/[\p{L}\p{N}][\p{L}\p{N}.+#-]*/gu) ?? [];
  const out: string[] = [];
  for (const part of parts) {
    const original = part.replace(/[.,-]+$/u, "");
    if (SHORT_TECH.has(original)) {
      out.push(original.toLowerCase());
      continue;
    }
    const token = part
      .toLowerCase()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.+#]+$/gu, "")
      .replace(/\.+$/u, "");
    if (token.length <= 2 || STOPWORDS.has(token) || /^\d+(?:\.\d+)?$/.test(token)) {
      continue;
    }
    out.push(token);
  }
  return out;
}

// Documented normalization for "exact approved statement": collapse whitespace runs to one space and trim.
// Nothing else (case, punctuation, quotes) is normalized.
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
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
