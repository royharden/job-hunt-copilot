import { extractRequirements } from "./extract.ts";
import { containsPhrase, significantTokens, uniqueStrings } from "./normalize.ts";
import type { Fact, RequirementMatch } from "./types.ts";

interface Hit {
  id: string;
  shared: number;
  jaccard: number;
  exact: boolean;
}

function scoreRequirement(
  postingId: string,
  text: string,
  ordinal: number,
  facts: Fact[],
): RequirementMatch {
  const reqTokens = uniqueStrings(significantTokens(text));
  const phrase = text.trim();
  const hits: Hit[] = facts.map((fact) => {
    const factTokens = uniqueStrings(significantTokens(`${fact.surface} ${fact.text}`));
    const factSet = new Set(factTokens);
    const sharedList = reqTokens.filter((token) => factSet.has(token));
    const unionSize = new Set([...reqTokens, ...factTokens]).size;
    const jaccard = unionSize === 0 ? 0 : sharedList.length / unionSize;
    const phraseHit = phrase.length >= 3 && containsPhrase(`${fact.surface}. ${fact.text}`, phrase);
    const allTokens = reqTokens.length > 0 && sharedList.length === reqTokens.length;
    return {
      id: fact.id,
      shared: sharedList.length,
      jaccard,
      exact: phraseHit || allTokens,
    };
  });

  const exactHits = hits.filter((hit) => hit.exact);
  if (exactHits.length > 0) {
    const count = exactHits.length;
    return {
      id: `req-${ordinal}`,
      postingId,
      ordinal,
      text,
      label: "exact",
      supportFactIds: exactHits.map((hit) => hit.id).slice(0, 5),
      reason:
        count === 1
          ? "All requirement terms appear in one approved fact."
          : `All requirement terms appear in ${count} approved facts.`,
    };
  }

  const lexical = hits
    .filter((hit) => {
      if (reqTokens.length === 1) return hit.shared === 1 && reqTokens[0].length >= 4;
      return hit.shared >= 2 && hit.jaccard >= 0.34;
    })
    .sort((left, right) => right.jaccard - left.jaccard || right.shared - left.shared);

  if (lexical.length > 0) {
    const best = lexical[0].jaccard;
    const support = lexical.filter((hit) => best - hit.jaccard <= 0.05).slice(0, 3);
    return {
      id: `req-${ordinal}`,
      postingId,
      ordinal,
      text,
      label: "lexical",
      supportFactIds: support.map((hit) => hit.id),
      reason: `Shared ${lexical[0].shared} term(s) with an approved fact (overlap ${best.toFixed(2)}).`,
    };
  }

  return {
    id: `req-${ordinal}`,
    postingId,
    ordinal,
    text,
    label: "gap",
    supportFactIds: [],
    reason: "No approved fact covers these terms.",
  };
}

export function matchRequirements(
  postingId: string,
  requirements: string[],
  facts: Fact[],
): RequirementMatch[] {
  return requirements.map((text, ordinal) => scoreRequirement(postingId, text, ordinal, facts));
}

export function matchPosting(postingId: string, postingText: string, facts: Fact[]): RequirementMatch[] {
  return matchRequirements(postingId, extractRequirements(postingText), facts);
}
