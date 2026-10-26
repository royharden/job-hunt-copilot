import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoStore, DEMO_STORAGE_KEY, demoStorageStatus, resetDemoStorage } from "../../src/lib/demoStore.ts";
import type { HuntRepository } from "../../src/lib/repository.ts";
import type { FactLine } from "../../supabase/functions/_shared/provenance/types.ts";

// Reviewer-owned fixtures. All data is invented; no browser files, accounts or network are used.
class SandboxStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

async function application(repo: HuntRepository) {
  return repo.createPosting({ organisation: "Juniper Test Labs", title: "Quality Analyst", body: "Required:\n- Python", url: null });
}

async function approvedAssertion(repo: HuntRepository): Promise<FactLine> {
  await repo.saveFact({ factId: null, kind: "accomplishment", text: "Wrote regression checks for the Juniper sandbox.",
    roleRef: null, projectLabel: null,
    origin: { type: "user_attestation", statement: "I confirm this synthetic test statement." } });
  const draft = (await repo.load()).profile.facts.find((fact) => fact.text === "Wrote regression checks for the Juniper sandbox.")!;
  await repo.approveFact(draft.factId, draft.versionId);
  return { lineId: "rv-line", section: "experience", kind: "fact", fact: { factId: draft.factId, versionId: draft.versionId },
    proposalText: draft.text, requirementIds: [] };
}

describe("RV demo repository acceptance", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new SandboxStorage());
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("RV forbids any network request"); }));
  });
  afterEach(() => vi.unstubAllGlobals());

  // what_bug_this_catches: approval silently recording submission or returning a server receipt for demo data.
  it("exports exact approved evidence locally, persists it, and requires a separate applied event", async () => {
    const repo = createDemoStore();
    const { applicationId } = await application(repo);
    const line = await approvedAssertion(repo);
    const packet = await repo.savePacketRevision(applicationId, null, null, [line]);
    const result = await repo.approvePacket(packet.packetId, packet.revision, null, "rv-approve");
    expect(result.receipt).toBe("demo_local");
    expect(result.lines.map((item) => item.grade)).toEqual(["verified"]);
    expect(result.export.plainText).toContain(line.proposalText);
    const ready = (await createDemoStore().load()).applications.find((item) => item.applicationId === applicationId)!;
    expect(ready.stage).toBe("approved");
    expect(await repo.applyStageChange({ applicationId, expectedRevision: ready.revision, toStage: "applied",
      replyId: null, chosenLabel: null, requestId: "rv-applied" })).toMatchObject({ ok: true });
    expect((await createDemoStore().load()).applications.find((item) => item.applicationId === applicationId)?.stage).toBe("applied");
    expect(fetch).not.toHaveBeenCalled();
  });

  // what_bug_this_catches: an empty packet receiving an approval and moving the board to ready.
  it("rejects zero lines without creating approval or stage history", async () => {
    const repo = createDemoStore();
    const { applicationId } = await application(repo);
    const packet = await repo.savePacketRevision(applicationId, null, null, []);
    await expect(repo.approvePacket(packet.packetId, 1, null, "rv-empty")).rejects.toMatchObject({ code: "blocked" });
    const state = await repo.load();
    expect(state.approvals).toHaveLength(0);
    expect(state.events).toHaveLength(0);
    expect(state.applications[0].stage).toBe("saved");
  });

  // what_bug_this_catches: a client edit or stale citation laundering itself through the approval API.
  it("refuses free wording and withdrawn evidence while preserving the original revision", async () => {
    const repo = createDemoStore();
    const { applicationId } = await application(repo);
    const line = await approvedAssertion(repo);
    const original = await repo.savePacketRevision(applicationId, null, null, [line]);
    const edit = await repo.savePacketRevision(applicationId, original.packetId, 1,
      [{ ...line, proposalText: "Led all regression checks for the Juniper sandbox." }]);
    await expect(repo.approvePacket(edit.packetId, 2, null, "rv-edit")).rejects.toMatchObject({ code: "blocked" });
    await expect(repo.approvePacket(original.packetId, 1, null, "rv-old")).rejects.toMatchObject({ code: "stale" });
    const restored = await repo.savePacketRevision(applicationId, original.packetId, 2, [line]);
    await repo.withdrawFact(line.fact.factId);
    await expect(repo.approvePacket(restored.packetId, 3, null, "rv-withdrawn")).rejects.toMatchObject({ code: "blocked" });
    expect((await repo.load()).packets[0].lines[0].proposalText).toBe(line.proposalText);
  });

  // what_bug_this_catches: failed hash comparison leaving behind a successful approval/event.
  it("rolls back approval when expected export bytes differ", async () => {
    const repo = createDemoStore();
    const { applicationId } = await application(repo);
    const packet = await repo.savePacketRevision(applicationId, null, null, [await approvedAssertion(repo)]);
    await expect(repo.approvePacket(packet.packetId, 1, "0".repeat(64), "rv-hash")).rejects.toMatchObject({ code: "stale" });
    expect((await repo.load()).approvals).toHaveLength(0);
    expect((await repo.load()).events).toHaveLength(0);
  });

  // what_bug_this_catches: moving a packet from one application's posting into another application.
  it("rejects cross-application packet reuse atomically", async () => {
    const repo = createDemoStore();
    const first = await application(repo);
    const second = await application(repo);
    const packet = await repo.savePacketRevision(first.applicationId, null, null, [await approvedAssertion(repo)]);
    await expect(repo.savePacketRevision(second.applicationId, packet.packetId, 1, packet.lines))
      .rejects.toMatchObject({ code: "invalid_input" });
    expect((await repo.load()).packets).toHaveLength(1);
  });

  // what_bug_this_catches: stale confirmation committing the reply but failing the stage update.
  it("stale reply confirmation changes neither reply nor history; fresh retry commits once", async () => {
    const repo = createDemoStore();
    const { applicationId } = await application(repo);
    const reply = await repo.addReply(applicationId, "Juniper Test Labs: we regret to inform you that we will not be moving forward.");
    await repo.applyStageChange({ applicationId, expectedRevision: 0, toStage: "applied", replyId: null, chosenLabel: null, requestId: "rv-manual" });
    const request = { applicationId, expectedRevision: 0, toStage: "rejected" as const, replyId: reply.replyId,
      chosenLabel: "rejection" as const, requestId: "rv-rejection" };
    expect(await repo.applyStageChange(request)).toMatchObject({ ok: false, code: "stale" });
    const stale = await repo.load();
    expect(stale.replies[0].confirmedAt).toBeNull();
    expect(stale.events).toHaveLength(1);
    const fresh = { ...request, expectedRevision: 1 };
    expect(await repo.applyStageChange(fresh)).toMatchObject({ ok: true, application: { stage: "rejected" } });
    expect(await repo.applyStageChange(fresh)).toMatchObject({ ok: true });
    expect(await repo.applyStageChange({ ...fresh, toStage: "offer" })).toMatchObject({ ok: false, code: "conflict" });
    const persisted = await createDemoStore().load();
    expect(persisted.events).toHaveLength(2);
    expect(persisted.replies[0].chosenLabel).toBe("rejection");
    expect(persisted.replies[0].confirmedAt).not.toBeNull();
  });

  // what_bug_this_catches: two page adapters overwriting each other's revisioned board changes.
  it("a second adapter observes committed changes and refuses a stale write", async () => {
    const first = createDemoStore();
    const { applicationId } = await application(first);
    const second = createDemoStore();
    const request = { applicationId, expectedRevision: 0, toStage: "interview" as const,
      replyId: null, chosenLabel: null, requestId: "rv-tab-a" };
    expect(await first.applyStageChange(request)).toMatchObject({ ok: true });
    expect(await second.applyStageChange({ ...request, toStage: "offer", requestId: "rv-tab-b" }))
      .toMatchObject({ ok: false, code: "stale" });
    expect((await second.load()).applications[0].stage).toBe("interview");
  });

  // what_bug_this_catches: acknowledgement recording applied or downgrading an interview/offer.
  it.each(["interview", "offer", "withdrawn", "rejected"] as const)("acknowledgement preserves %s", async (stage) => {
    const repo = createDemoStore();
    const { applicationId } = await application(repo);
    await repo.applyStageChange({ applicationId, expectedRevision: 0, toStage: stage, replyId: null,
      chosenLabel: null, requestId: "rv-start" });
    const reply = await repo.addReply(applicationId, "Juniper Test Labs received your application.");
    expect(await repo.applyStageChange({ applicationId, expectedRevision: 1, toStage: stage,
      replyId: reply.replyId, chosenLabel: "acknowledgement", requestId: "rv-ack" }))
      .toMatchObject({ ok: true, application: { stage } });
  });

  // what_bug_this_catches: incompatible demo data reset deleting another application's browser storage.
  it("requires explicit reset for incompatible demo state and preserves unrelated keys", () => {
    localStorage.setItem("rv-unrelated", "keep");
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ schema: -1 }));
    expect(demoStorageStatus()).toBe("incompatible");
    expect(() => createDemoStore()).toThrow(/older version|reset/i);
    expect(localStorage.getItem(DEMO_STORAGE_KEY)).not.toBeNull();
    resetDemoStorage();
    expect(demoStorageStatus()).toBe("empty");
    expect(localStorage.getItem("rv-unrelated")).toBe("keep");
  });
});
