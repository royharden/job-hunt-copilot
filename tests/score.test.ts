import { describe, expect, it } from "vitest";
import { assemblePacket, removeLine } from "../supabase/functions/_shared/provenance/draft.ts";
import { samplePosting } from "../supabase/functions/_shared/provenance/fixtures.ts";
import { gatePacket } from "../supabase/functions/_shared/provenance/gate.ts";
import { packetCoverage, profileCoverage } from "../supabase/functions/_shared/provenance/score.ts";
import { counter, repairedProfile, reviewedJourney } from "./helpers.ts";

describe("coverage", () => {
  // 6 required (weight 2) + 1 preferred (weight 1) = 13. Direct: React, Python, TypeScript = 6.
  // Partial latency (preferred) = 0.5. Gaps and the unconfirmed years clause stay in the denominator.
  it("computes profile coverage with gaps in the denominator", () => {
    const { requirements, evidence } = reviewedJourney();
    const coverage = profileCoverage(requirements, evidence);
    expect(coverage.denominator).toBe(13);
    expect(coverage.numerator).toBe(6.5);
    expect(coverage.percent).toBe(50);
    expect(coverage.counts).toMatchObject({ direct: 3, partial: 1, gap: 2, unconfirmed: 1, unreviewed: 0 });
  });

  // what_bug_this_catches: showing a percentage before review is finished, or dividing by zero.
  it("withholds the percentage while anything is unreviewed and for an empty set", () => {
    const { requirements, evidence } = reviewedJourney();
    requirements[0] = { ...requirements[0], reviewed: false };
    const coverage = profileCoverage(requirements, evidence);
    expect(coverage.percent).toBeNull();
    expect(coverage.withheldReason).toMatch(/1 requirement/);
    expect(profileCoverage([], []).percent).toBeNull();
  });

  it("counts duplicates once", () => {
    const { requirements, evidence } = reviewedJourney();
    const duplicate = { ...requirements[0], requirementId: "dup", versionId: "dup-v1", ordinal: 99 };
    expect(profileCoverage([...requirements, duplicate], evidence).denominator).toBe(13);
  });

  // what_bug_this_catches: packet coverage that ignores which lines were actually kept.
  it("lowers packet coverage when a represented line is removed, without changing profile coverage", () => {
    const profile = repairedProfile();
    const { requirements, evidence } = reviewedJourney(profile);
    const posting = samplePosting();
    const lines = assemblePacket(evidence, profile, posting, counter("line"));
    const full = gatePacket({ lines }, { profile, posting });
    expect(packetCoverage(requirements, evidence, full.lines).percent).toBe(50);
    const pythonLine = lines.find((line) => line.kind === "fact" && line.proposalText.includes("Python"))!;
    const fewer = gatePacket({ lines: removeLine(lines, pythonLine.lineId) }, { profile, posting });
    const packet = packetCoverage(requirements, evidence, fewer.lines);
    expect(packet.numerator).toBe(4.5);
    expect(packet.counts.not_in_packet).toBe(1);
    expect(profileCoverage(requirements, evidence).percent).toBe(50);
  });
});
