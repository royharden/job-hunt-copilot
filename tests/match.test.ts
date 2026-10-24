import { describe, expect, it } from "vitest";
import { draftFromFacts } from "../supabase/functions/_shared/provenance/draft.ts";
import { extractRequirements } from "../supabase/functions/_shared/provenance/extract.ts";
import {
  FACT_EMPLOYER,
  SAMPLE_FACTS,
  SAMPLE_FELLOWSHIP_POSTING,
  SAMPLE_JOB_POSTING,
} from "../supabase/functions/_shared/provenance/fixtures.ts";
import { gateMaterials, isApprovable } from "../supabase/functions/_shared/provenance/gate.ts";
import { matchPosting, matchRequirements } from "../supabase/functions/_shared/provenance/match.ts";

describe("requirement match and local draft", () => {
  it("labels the sample job exactly, lexically, or as a gap", () => {
    const requirements = extractRequirements(SAMPLE_JOB_POSTING);
    expect(requirements).toEqual(["Python services", "Kubernetes administration", "Engineer"]);
    const matches = matchPosting("post-job", SAMPLE_JOB_POSTING, SAMPLE_FACTS);
    expect(matches.map((match) => [match.text, match.label])).toEqual([
      ["Python services", "exact"],
      ["Kubernetes administration", "gap"],
      ["Engineer", "exact"],
    ]);
    expect(matches[1].supportFactIds).toEqual([]);
    const draft = draftFromFacts(matches, SAMPLE_FACTS);
    expect(draft.bullets.length).toBeGreaterThan(0);
    expect(draft.bullets.some((bullet) => bullet.text.includes("Kubernetes"))).toBe(false);
    expect(isApprovable(gateMaterials(draft, SAMPLE_FACTS))).toBe(true);
  });

  it("keeps an unbacked GPA off the fellowship draft", () => {
    const matches = matchPosting("post-fellowship", SAMPLE_FELLOWSHIP_POSTING, SAMPLE_FACTS);
    expect(matches.map((match) => [match.text, match.label])).toEqual([
      ["Enrolled at an accredited university", "exact"],
      ["3.9 GPA", "gap"],
    ]);
    const draft = draftFromFacts(matches, SAMPLE_FACTS);
    expect(draft.bullets).toHaveLength(1);
    expect(draft.bullets[0].text).not.toContain("3.9");
    expect(isApprovable(gateMaterials(draft, SAMPLE_FACTS))).toBe(true);
  });

  it("uses lexical when two terms match and one does not", () => {
    const matches = matchRequirements("post-lex", ["Contoso billing migration"], SAMPLE_FACTS);
    expect(matches[0].label).toBe("lexical");
    expect(matches[0].supportFactIds).toContain(FACT_EMPLOYER);
  });
});
