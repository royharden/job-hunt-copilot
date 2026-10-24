import { describe, expect, it } from "vitest";
import { FACT_LATENCY, SKILL_REACT, sampleProfile } from "../supabase/functions/_shared/provenance/fixtures.ts";
import { blockingProblems, validateProfile } from "../supabase/functions/_shared/provenance/health.ts";
import { checkOrigin, currentFacts } from "../supabase/functions/_shared/provenance/versions.ts";
import { repairedProfile } from "./helpers.ts";

describe("profile health", () => {
  // what_bug_this_catches: skill evidence silently following a superseded fact version.
  it("flags the React link to the superseded version and offers a relink repair", () => {
    const report = validateProfile(sampleProfile());
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0].code).toBe("withdrawn_support");
    expect(report.problems[0].ids).toContain(SKILL_REACT);
    expect(report.problems[0].repairs.map((repair) => repair.type)).toEqual(["relink_to_current", "remove_link"]);
    expect(validateProfile(repairedProfile()).problems).toHaveLength(0);
  });

  it("requires source spans to match the exact source version", () => {
    const profile = sampleProfile();
    const fact = profile.facts.find((item) => item.factId === FACT_LATENCY)!;
    expect(checkOrigin(profile, fact.origin)).toBeNull();
    if (fact.origin.type !== "source_span") throw new Error("fixture changed");
    fact.origin.quote = "Cut p95 latency by 40% on the billing API.";
    expect(checkOrigin(profile, fact.origin)).toMatch(/does not match/);
    expect(validateProfile(profile).problems.map((problem) => problem.code)).toContain("bad_span");
  });

  it("reports bad dates, wrong-kind refs, broken aliases and unused skills", () => {
    const profile = repairedProfile();
    profile.roles[0].end = "2018-01";
    const degree = profile.facts.find((item) => item.kind === "education")!;
    degree.roleRef = { roleId: profile.roles[0].roleId, roleVersionId: profile.roles[0].versionId };
    profile.skills[1].aliases.push({ alias: "python3", approved: true });
    profile.skills.push({ skillId: "skill-unused", canonical: "Elixir", aliases: [] });
    const report = validateProfile(profile);
    const codes = report.problems.map((problem) => problem.code);
    expect(codes).toContain("bad_date");
    expect(codes).toContain("wrong_kind_ref");
    expect(codes).toContain("broken_alias");
    expect(report.notes.map((note) => note.code)).toEqual(["unused_skill"]);
  });

  // what_bug_this_catches: one broken unrelated fact disabling the whole app.
  it("only blocks selected evidence", () => {
    const profile = sampleProfile();
    const report = validateProfile(profile);
    const python = currentFacts(profile).find((fact) => fact.text.includes("Python"))!;
    expect(blockingProblems(report, [{ factId: python.factId, versionId: python.versionId }])).toHaveLength(0);
    expect(blockingProblems(report, [], [SKILL_REACT])).toHaveLength(1);
  });

  it("withdrawal removes a fact from current evidence without rewriting history", () => {
    const profile = repairedProfile();
    const latency = profile.facts.find((item) => item.factId === FACT_LATENCY)!;
    profile.facts.push({
      ...latency,
      versionId: "withdrawn-v",
      status: "withdrawn",
      withdrawnAt: "2026-10-22T00:00:00.000Z",
      createdAt: "2026-10-22T00:00:00.000Z",
    });
    expect(currentFacts(profile).some((fact) => fact.factId === FACT_LATENCY)).toBe(false);
    expect(profile.facts.filter((fact) => fact.factId === FACT_LATENCY)).toHaveLength(2);
  });
});
