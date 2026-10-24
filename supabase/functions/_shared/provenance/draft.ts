import { LIMITS } from "./limits.ts";
import type { CoverLine, DraftBullet, Fact, RequirementMatch } from "./types.ts";

export function draftFromFacts(
  matches: RequirementMatch[],
  facts: Fact[],
): { bullets: DraftBullet[]; cover: CoverLine[] } {
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const seen = new Set<string>();
  const bullets: DraftBullet[] = [];
  for (const match of matches) {
    if (match.label === "gap") continue;
    for (const id of match.supportFactIds) {
      const fact = byId.get(id);
      if (!fact || seen.has(fact.id)) continue;
      seen.add(fact.id);
      bullets.push({
        text: `${fact.text} [[fact:${fact.id}]]`,
        factIds: [fact.id],
      });
      if (bullets.length >= LIMITS.bulletsPerDraft) break;
    }
    if (bullets.length >= LIMITS.bulletsPerDraft) break;
  }
  const cover: CoverLine[] = bullets.slice(0, 3).map((bullet, index) => ({
    heading: index === 0 ? "Evidence" : "Further evidence",
    text: bullet.text,
    factIds: [...bullet.factIds],
  }));
  return { bullets, cover };
}
