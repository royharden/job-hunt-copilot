import { describe, expect, it } from "vitest";
import { representedRoleSpan } from "../supabase/functions/_shared/provenance/aliases.ts";
import { extractRequirements, proposeSplit } from "../supabase/functions/_shared/provenance/extract.ts";
import { SAMPLE_JOB_POSTING, SKILL_PYTHON, sampleProfile } from "../supabase/functions/_shared/provenance/fixtures.ts";
import { confirmationWarnings, proposeEvidence } from "../supabase/functions/_shared/provenance/match.ts";
import { significantTokens } from "../supabase/functions/_shared/provenance/normalize.ts";
import { repairedProfile, reviewedJourney } from "./helpers.ts";

describe("requirement extraction", () => {
  it("keeps original spans, priority and flags", () => {
    const found = extractRequirements(SAMPLE_JOB_POSTING);
    expect(found.map((item) => item.clause)).toEqual([
      "Strong React experience",
      "5+ years building production web applications",
      "Experience building Python services",
      "Kubernetes administration",
      "TypeScript and GraphQL",
      "Experience reducing API latency",
      "Health insurance and 401k matching",
    ]);
    for (const item of found) expect(SAMPLE_JOB_POSTING.slice(item.quote.start, item.quote.end)).toBe(item.quote.text);
    expect(found[5].priority).toBe("preferred");
    expect(found[1].flags).toContain("years");
    expect(found[0].flags).toContain("proficiency");
    expect(found[4].flags).toContain("mixed");
    expect(found[6].flags).toContain("benefit");
    expect(proposeSplit("TypeScript and GraphQL")).toEqual(["TypeScript", "GraphQL"]);
  });

  // what_bug_this_catches: short requirement lines swallowed as section headings.
  it("keeps short requirement lines that are not headings", () => {
    const found = extractRequirements(["Must have Python", "5+ years required", "Benefits", "- Dental plan"].join("\n"));
    expect(found.map((item) => item.clause)).toEqual(["Must have Python", "5+ years required", "Dental plan"]);
    expect(found[2].flags).toContain("benefit");
  });

  it("flags credentials and negation", () => {
    const found = extractRequirements("Requirements:\n- Bachelor's degree in CS\n- No prior security clearance needed");
    expect(found[0].flags).toContain("credential");
    expect(found[1].flags).toContain("negation");
  });

  // what_bug_this_catches: short skill names (C, R, Go) silently dropped by a length filter, while the
  // English word "go" is not treated as a skill.
  it("preserves short technology tokens by case", () => {
    expect(significantTokens("Go and R and C")).toEqual(["go", "r", "c"]);
    expect(significantTokens("ready to go")).toEqual(["ready"]);
  });
});

describe("evidence proposals", () => {
  it("proposes exact, partial and gap tiers but confirms nothing", () => {
    const { requirements } = reviewedJourney();
    const evidence = proposeEvidence(requirements, repairedProfile());
    const tierOf = (clause: string) =>
      evidence.find((item) => requirements.find((req) => req.requirementId === item.requirementId)!.clause === clause)!
        .proposedTier;
    expect(tierOf("Strong React experience")).toBe("exact");
    expect(tierOf("Experience building Python services")).toBe("exact");
    expect(tierOf("TypeScript")).toBe("exact");
    expect(tierOf("Kubernetes administration")).toBe("gap");
    expect(tierOf("GraphQL")).toBe("gap");
    expect(tierOf("Experience reducing API latency")).toBe("partial");
    expect(evidence.every((item) => item.confirmed === null)).toBe(true);
    // removed benefit clauses get no evidence row
    expect(evidence.some((item) => requirements.find((req) => req.requirementId === item.requirementId)!.removed)).toBe(false);
  });

  // what_bug_this_catches: a confirmation surviving a fact edit, laundering stale evidence.
  it("drops a confirmation when the confirmed fact version is superseded", () => {
    const profile = repairedProfile();
    const { requirements, evidence } = reviewedJourney(profile);
    const python = profile.facts.find((fact) => fact.text.startsWith("Built internal Python"))!;
    profile.facts.push({
      ...python,
      versionId: "python-v2",
      text: "Built internal Python services for billing.",
      createdAt: "2026-10-22T00:00:00.000Z",
    });
    const next = proposeEvidence(requirements, profile, evidence);
    const pythonReq = requirements.find((req) => req.clause === "Experience building Python services")!;
    expect(next.find((item) => item.requirementId === pythonReq.requirementId)!.confirmed).toBeNull();
    const reactReq = requirements.find((req) => req.clause === "Strong React experience")!;
    expect(next.find((item) => item.requirementId === reactReq.requirementId)!.confirmed).not.toBeNull();
  });

  // what_bug_this_catches: un-reviewing a confirmed clause keeping its confirmation (live save rejected,
  // demo accepted).
  it("drops a confirmation when its requirement is no longer reviewed", () => {
    const profile = repairedProfile();
    const { requirements, evidence } = reviewedJourney(profile);
    const react = requirements.find((req) => req.clause === "Strong React experience")!;
    const unreviewed = requirements.map((req) => (req.requirementId === react.requirementId ? { ...req, reviewed: false } : req));
    const next = proposeEvidence(unreviewed, profile, evidence);
    expect(next.find((item) => item.requirementId === react.requirementId)!.confirmed).toBeNull();
  });

  it("warns that years are not proven by a match", () => {
    const { requirements } = reviewedJourney();
    const years = requirements.find((req) => req.flags.includes("years"))!;
    expect(confirmationWarnings(years).join(" ")).toMatch(/Years are not proven/);
  });

  // what_bug_this_catches: role span reported as total experience, or unattested spans counted as tenure.
  it("reports represented role span separately from attested duration", () => {
    const span = representedRoleSpan(sampleProfile(), SKILL_PYTHON, "2026-10");
    expect(span.months).toBe(40); // 2019-03..2022-06 inclusive
    expect(span.attestedMonths).toBeNull();
  });
});
