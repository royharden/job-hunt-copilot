import { describe, expect, it } from "vitest";
import { acceptFallback, assemblePacket, moveLine, removeLine, replaceLineText } from "../supabase/functions/_shared/provenance/draft.ts";
import {
  FABRICATIONS,
  FACT_LATENCY,
  FACT_LATENCY_V1,
  FACT_MIGRATION,
  FACT_MIGRATION_V1,
  FACT_PYTHON,
  FACT_PYTHON_V1,
  FACT_REACT,
  FACT_REACT_V1,
  UNKNOWN_FACT,
  samplePosting,
} from "../supabase/functions/_shared/provenance/fixtures.ts";
import { exportPacket, gatePacket, guardProposal, renderLine } from "../supabase/functions/_shared/provenance/gate.ts";
import type { FactLine, PacketLine, Profile } from "../supabase/functions/_shared/provenance/types.ts";
import { counter, repairedProfile, reviewedJourney } from "./helpers.ts";

function factLine(text: string, factId: string, versionId: string): FactLine {
  return { lineId: "l1", section: "experience", kind: "fact", fact: { factId, versionId }, proposalText: text, requirementIds: [] };
}

function codes(text: string, factId: string, versionId: string, profile: Profile = repairedProfile()): string[] {
  return guardProposal(text, [{ factId, versionId }], profile).map((finding) => finding.code);
}

describe("guard", () => {
  // what_bug_this_catches: each labelled fabrication from the demo lab slipping through.
  it("blocks every labelled fabrication with the expected finding and offers the original sentence", () => {
    const profile = repairedProfile();
    for (const fabrication of FABRICATIONS) {
      const findings = guardProposal(fabrication.text, fabrication.cites, profile).map((finding) => finding.code);
      expect(findings, fabrication.id).toContain(fabrication.expectedCode);
      const rendered = renderLine(
        factLine(fabrication.text, fabrication.cites[0].factId, fabrication.cites[0].versionId),
        { profile, posting: samplePosting() },
      );
      expect(rendered.grade, fabrication.id).toBe("reverted");
      expect(rendered.text).toBe("");
      expect(rendered.fallback?.fact).toEqual(fabrication.cites[0]);
    }
  });

  it("verifies an exact approved sentence after whitespace normalization only", () => {
    const profile = repairedProfile();
    const line = factLine("  Cut p95 latency by 12%   on the billing API. ", FACT_LATENCY, FACT_LATENCY_V1);
    expect(renderLine(line, { profile, posting: samplePosting() }).grade).toBe("verified");
    const lower = factLine("cut p95 latency by 12% on the billing API.", FACT_LATENCY, FACT_LATENCY_V1);
    expect(renderLine(lower, { profile, posting: samplePosting() }).grade).toBe("unchecked");
  });

  it("rejects phantom, foreign, stale and unapproved references", () => {
    const profile = repairedProfile();
    expect(codes("Built internal Python services for the billing platform.", UNKNOWN_FACT, "nope")).toEqual(["phantom_ref"]);
    expect(codes("Built React dashboards for support agents.", FACT_REACT, FACT_REACT_V1)).toEqual(["stale_ref"]);
    const draft = profile.facts.find((fact) => fact.factId === FACT_PYTHON)!;
    profile.facts.push({ ...draft, versionId: "draft-v", status: "draft", createdAt: "2026-10-22T00:00:00.000Z" });
    expect(codes("Built internal Python services for the billing platform.", FACT_PYTHON, "draft-v", profile)).toEqual([
      "unapproved_ref",
    ]);
    expect(guardProposal("Anything.", [], profile).map((finding) => finding.code)).toEqual(["uncited"]);
  });

  it("checks numeric context, magnitude and pooling", () => {
    const p = repairedProfile();
    expect(codes("Cut p95 latency by 40% on the billing API.", FACT_LATENCY, FACT_LATENCY_V1, p)).toContain("invented_number");
    expect(codes("Cut p95 latency by 12 ms on the billing API.", FACT_LATENCY, FACT_LATENCY_V1, p)).toContain("unit_swap");
    expect(codes("Cut p99 latency by 12% on the billing API.", FACT_LATENCY, FACT_LATENCY_V1, p)).toContain("unsupported_addition");
    expect(codes("Saved $3M on the billing API.", FACT_LATENCY, FACT_LATENCY_V1, p)).toContain("invented_number");
    const pooled = guardProposal(
      "Cut p95 latency by 12% while serving 40 support agents.",
      [
        { factId: FACT_LATENCY, versionId: FACT_LATENCY_V1 },
        { factId: FACT_REACT, versionId: "ffffffff-ffff-4fff-8fff-000000000014" },
      ],
      p,
    ).map((finding) => finding.code);
    expect(pooled).toContain("pooled_numbers");
  });

  it("checks tools, collisions, employers, titles, polarity and scope", () => {
    const p = repairedProfile();
    // Java is not JavaScript; an unknown word stays unknown rather than proving anything.
    expect(codes("Built internal Java services for the billing platform.", FACT_PYTHON, FACT_PYTHON_V1, p)).toContain("unbacked_tool");
    expect(codes("Built internal Python services for the billing platform at Initech.", FACT_PYTHON, FACT_PYTHON_V1, p)).toContain(
      "unbacked_org",
    );
    expect(codes("Served as Staff Engineer building Python services for the billing platform.", FACT_PYTHON, FACT_PYTHON_V1, p)).toContain(
      "unbacked_title",
    );
    expect(codes("Did not build internal Python services for the billing platform.", FACT_PYTHON, FACT_PYTHON_V1, p)).toContain(
      "polarity_change",
    );
    expect(codes("Migrated the payments API to TypeScript.", FACT_MIGRATION, FACT_MIGRATION_V1, p)).toContain("scope_change");
    // a team name after "with" is not automatically an employer
    expect(codes("Built internal Python services with Platform Team for the billing platform.", FACT_PYTHON, FACT_PYTHON_V1, p)).not.toContain(
      "unbacked_org",
    );
  });
});

describe("packet assembly, approval gate and export", () => {
  function assembled() {
    const profile = repairedProfile();
    const { evidence } = reviewedJourney(profile);
    const posting = samplePosting();
    const lines = assemblePacket(evidence, profile, posting, counter("line"));
    return { profile, posting, lines };
  }

  it("assembles only confirmed evidence plus fixed templates, all verified", () => {
    const { profile, posting, lines } = assembled();
    const result = gatePacket({ lines }, { profile, posting });
    expect(result.approvable).toBe(true);
    expect(lines[0].kind === "template" && lines[0].templateId).toBe("application_opening");
    expect(lines.at(-1)!.kind === "template" && (lines.at(-1) as Extract<PacketLine, { kind: "template" }>).templateId).toBe("generic_closing");
    expect(result.renderedText).not.toMatch(/Kubernetes|GraphQL/);
    expect(result.renderedText).toContain("Worked as Senior Software Engineer at Fabrikam Inc during 2022-07 to present.");
    const exported = exportPacket(result.lines);
    expect(exported.plainText).toBe(result.renderedText);
    expect(exported.markdown).toContain("- Built React dashboards used by 40 support agents.");
  });

  // what_bug_this_catches: approving a packet with an unverified or edited line, or with zero evidence lines.
  it("refuses edited lines, template edits and zero-evidence packets", () => {
    const { profile, posting, lines } = assembled();
    const target = lines.find((line) => line.kind === "fact")!;
    const edited = replaceLineText(lines, target.lineId, "Led everything at Fabrikam Inc.");
    const editedResult = gatePacket({ lines: edited }, { profile, posting });
    expect(editedResult.approvable).toBe(false);
    const flagged = editedResult.lines.find((line) => line.lineId === target.lineId)!;
    expect(["reverted", "unchecked"]).toContain(flagged.grade);
    const restored = acceptFallback(edited, target.lineId, flagged.fallback!);
    expect(gatePacket({ lines: restored }, { profile, posting }).approvable).toBe(true);

    const opening = lines[0];
    const templateEdit = replaceLineText(lines, opening.lineId, "I am the perfect candidate for Northwind Traders.");
    expect(gatePacket({ lines: templateEdit }, { profile, posting }).lines[0].findings[0].code).toBe("template_edited");

    const templatesOnly = lines.filter((line) => line.kind === "template");
    expect(gatePacket({ lines: templatesOnly }, { profile, posting }).approvable).toBe(false);
    expect(gatePacket({ lines: [] }, { profile, posting }).approvable).toBe(false);
  });

  it("line removal and reordering produce new arrays without mutating the revision", () => {
    const { lines } = assembled();
    const snapshot = JSON.stringify(lines);
    const removed = removeLine(lines, lines[1].lineId);
    const moved = moveLine(lines, lines[1].lineId, 1);
    expect(removed).toHaveLength(lines.length - 1);
    expect(moved[2].lineId).toBe(lines[1].lineId);
    expect(JSON.stringify(lines)).toBe(snapshot);
  });

  // what_bug_this_catches: a withdrawn fact staying exportable through an old packet revision.
  it("blocks a line whose fact was withdrawn after assembly", () => {
    const { profile, posting, lines } = assembled();
    const python = profile.facts.find((fact) => fact.factId === FACT_PYTHON)!;
    profile.facts.push({ ...python, versionId: "w", status: "withdrawn", withdrawnAt: "2026-10-23T01:00:00.000Z", createdAt: "2026-10-23T01:00:00.000Z" });
    const result = gatePacket({ lines }, { profile, posting });
    expect(result.approvable).toBe(false);
    expect(result.lines.some((line) => line.grade === "blocked" && line.findings.some((finding) => finding.code === "stale_ref"))).toBe(true);
  });

  // what_bug_this_catches: a verified line whose own evidence graph is broken (PLAN sections 5-7).
  it("blocks selected lines whose fact or role has a health problem, but not unrelated facts", () => {
    const { profile, posting, lines } = assembled();
    const pythonLine = lines.find((line) => line.kind === "fact" && line.proposalText.includes("Python"))!;

    const badSpan = structuredClone(profile);
    const python = badSpan.facts.find((fact) => fact.factId === FACT_PYTHON)!;
    if (python.origin.type !== "source_span") throw new Error("fixture changed");
    python.origin.end -= 1;
    const spanResult = gatePacket({ lines }, { profile: badSpan, posting });
    const flagged = spanResult.lines.find((line) => line.lineId === pythonLine.lineId)!;
    expect(flagged.grade).toBe("blocked");
    expect(flagged.findings[0].code).toBe("health_bad_span");
    expect(spanResult.approvable).toBe(false);

    const withdrawnRole = structuredClone(profile);
    const contoso = withdrawnRole.roles.find((role) => role.employer === "Contoso Ltd")!;
    withdrawnRole.roles.push({ ...contoso, versionId: "role-w", status: "withdrawn", createdAt: "2026-10-23T02:00:00.000Z" });
    const roleResult = gatePacket({ lines }, { profile: withdrawnRole, posting });
    expect(roleResult.lines.find((line) => line.lineId === pythonLine.lineId)!.findings.map((finding) => finding.code)).toContain(
      "health_withdrawn_support",
    );

    const unrelated = structuredClone(profile);
    const degree = unrelated.facts.find((fact) => fact.kind === "education")!;
    degree.roleRef = { roleId: contoso.roleId, roleVersionId: contoso.versionId }; // wrong-kind ref on an unselected fact
    expect(gatePacket({ lines }, { profile: unrelated, posting }).approvable).toBe(true);
  });

  it("catches direction changes, subject/scope reassignment, invented years and self-exempt cover lines", () => {
    const p = repairedProfile();
    expect(codes("Increased p95 latency by 12% on the billing API.", FACT_LATENCY, FACT_LATENCY_V1, p)).toContain("direction_change");
    expect(codes("Built internal Python services for the billing platform in 2017.", FACT_PYTHON, FACT_PYTHON_V1, p)).toContain(
      "invented_number",
    );
    const supported = structuredClone(p);
    supported.facts.push({
      ...supported.facts.find((fact) => fact.factId === FACT_PYTHON)!,
      factId: "fact-support",
      versionId: "fact-support-v1",
      text: "Supported the team lead who designed the billing schema.",
      origin: { type: "user_attestation", statement: "Supported the team lead who designed the billing schema.", attestedAt: "2026-10-01T00:00:00.000Z" },
    });
    expect(codes("Designed the billing schema.", "fact-support", "fact-support-v1", supported)).toContain("scope_change");
    // A cover/closing line cannot exempt itself: any edit to fixed template wording is blocked.
    const { lines, posting } = assembled();
    const closing = lines.at(-1)!;
    const selfExempt = replaceLineText(lines, closing.lineId, "Thank you for considering my application; I led every project at Fabrikam Inc.");
    const result = gatePacket({ lines: selfExempt }, { profile: p, posting });
    expect(result.lines.at(-1)!.grade).toBe("blocked");
    expect(result.approvable).toBe(false);
  });
});

