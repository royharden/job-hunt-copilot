import { describe, expect, it } from "vitest";
import { approvalIsCurrent, bindingSha256, computeBinding, staleReasons } from "../supabase/functions/_shared/provenance/binding.ts";
import { assemblePacket, moveLine } from "../supabase/functions/_shared/provenance/draft.ts";
import { FACT_LATENCY, samplePosting } from "../supabase/functions/_shared/provenance/fixtures.ts";
import type { Approval, PacketRevision, Profile } from "../supabase/functions/_shared/provenance/types.ts";
import { counter, repairedProfile, reviewedJourney } from "./helpers.ts";

function setup() {
  const profile = repairedProfile();
  const { evidence } = reviewedJourney(profile);
  const posting = samplePosting();
  const revision: PacketRevision = {
    packetId: "packet-1",
    applicationId: "app-1",
    postingVersionId: posting.versionId,
    revision: 1,
    parentRevision: null,
    lines: assemblePacket(evidence, profile, posting, counter("line")),
    createdAt: "2026-10-23T00:00:00.000Z",
  };
  return { profile, posting, revision };
}

function bind(profile: Profile, revision: PacketRevision, mappingRevision = 1) {
  const posting = samplePosting();
  return computeBinding({
    applicationId: "app-1",
    posting,
    requirementSetRevision: 1,
    mappingRevision,
    revision,
    profile,
  });
}

function approve(profile: Profile, revision: PacketRevision): Approval {
  const binding = bind(profile, revision);
  return {
    packetId: revision.packetId,
    revision: revision.revision,
    renderedSha256: binding.renderedSha256,
    bindingSha256: bindingSha256(binding),
    binding,
    wordingAttested: false,
    approvedAt: "2026-10-23T00:00:00.000Z",
    source: "demo_local",
  };
}

describe("approval binding", () => {
  it("is current for unchanged inputs", () => {
    const { profile, revision } = setup();
    const approval = approve(profile, revision);
    expect(approvalIsCurrent(approval, bind(profile, revision))).toBe(true);
  });

  // what_bug_this_catches: an old approval authorizing export after its evidence or packet changed.
  it("goes stale on withdrawal, mapping edits, alias edits, reordering and new revisions", () => {
    const { profile, revision } = setup();
    const approval = approve(profile, revision);

    const withdrawn = structuredClone(profile);
    const latency = withdrawn.facts.find((fact) => fact.factId === FACT_LATENCY)!;
    withdrawn.facts.push({ ...latency, versionId: "w", status: "withdrawn", createdAt: "2026-10-24T00:00:00.000Z" });
    expect(approvalIsCurrent(approval, bind(withdrawn, revision))).toBe(false);

    expect(approvalIsCurrent(approval, bind(profile, revision, 2))).toBe(false);
    expect(staleReasons(approval.binding, bind(profile, revision, 2))).toEqual(["mappingRevision"]);

    const aliases = structuredClone(profile);
    aliases.skills[0].aliases.push({ alias: "Py", approved: true });
    expect(staleReasons(approval.binding, bind(aliases, revision))).toEqual(["aliasDigest"]);

    const reordered = { ...revision, lines: moveLine(revision.lines, revision.lines[2].lineId, 1) };
    expect(approvalIsCurrent(approval, bind(profile, reordered))).toBe(false);

    const next = { ...revision, revision: 2, parentRevision: 1 };
    expect(staleReasons(approval.binding, bind(profile, next))).toEqual(["packetRevision"]);
  });

  it("refuses a missing approval", () => {
    const { profile, revision } = setup();
    expect(approvalIsCurrent(null, bind(profile, revision))).toBe(false);
  });
});
