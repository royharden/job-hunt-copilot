import { describe, expect, it } from "vitest";
import {
  applyStageChange,
  stageAfterApproval,
  stageAfterReply,
  stageRequestFingerprint,
  type StageChangeRecord,
} from "../supabase/functions/_shared/provenance/board.ts";
import { classifyReply } from "../supabase/functions/_shared/provenance/classify.ts";
import type { Application, Reply } from "../supabase/functions/_shared/provenance/types.ts";
import { counter } from "./helpers.ts";

const NOW = "2026-10-23T12:00:00.000Z";

function application(stage: Application["stage"] = "applied"): Application {
  return {
    applicationId: "app-1",
    postingId: "post-1",
    stage,
    revision: 3,
    notes: "",
    selectedPacketId: null,
    selectedPacketRevision: null,
    updatedAt: NOW,
  };
}

function reply(): Reply {
  return {
    replyId: "reply-1",
    applicationId: "app-1",
    body: "We will not be moving forward.",
    prediction: classifyReply("We will not be moving forward.", null),
    chosenLabel: null,
    confirmedAt: null,
    createdAt: NOW,
  };
}

describe("stage rules", () => {
  it("approval means ready and never downgrades real-world progress", () => {
    expect(stageAfterApproval("saved")).toBe("approved");
    expect(stageAfterApproval("preparing")).toBe("approved");
    expect(stageAfterApproval("applied")).toBe("applied");
    expect(stageAfterApproval("interview")).toBe("interview");
  });

  it("applies reply rules without downgrades", () => {
    expect(stageAfterReply("withdrawn", "offer")).toBe("withdrawn");
    expect(stageAfterReply("rejected", "interview")).toBe("rejected");
    expect(stageAfterReply("offer", "interview")).toBe("offer");
    expect(stageAfterReply("interview", "acknowledgement")).toBe("interview");
    expect(stageAfterReply("approved", "acknowledgement")).toBe("approved"); // never silently records applied
    expect(stageAfterReply("applied", "rejection")).toBe("rejected");
  });
});

describe("apply_stage_change model", () => {
  const request = {
    applicationId: "app-1",
    expectedRevision: 3,
    toStage: "rejected" as const,
    replyId: "reply-1",
    chosenLabel: "rejection" as const,
    requestId: "req-1",
  };

  it("confirms the reply, moves the stage, bumps the revision and appends one event together", () => {
    const result = applyStageChange({ application: application(), replies: [reply()], history: [] }, request, NOW, counter("ev"));
    if (!result.ok) throw new Error(result.message);
    expect(result.application.stage).toBe("rejected");
    expect(result.application.revision).toBe(4);
    expect(result.reply?.chosenLabel).toBe("rejection");
    expect(result.event).toMatchObject({ fromStage: "applied", toStage: "rejected", revision: 4, requestId: "req-1" });
  });

  // what_bug_this_catches: a retried click recording two events, or a reused request id with new data.
  it("is idempotent per request id and conflicts on a changed payload", () => {
    const first = applyStageChange({ application: application(), replies: [reply()], history: [] }, request, NOW, counter("ev"));
    if (!first.ok) throw new Error(first.message);
    const history: StageChangeRecord[] = [
      { requestId: "req-1", fingerprint: stageRequestFingerprint(request), result: first },
    ];
    const retry = applyStageChange({ application: first.application, replies: [first.reply!], history }, request, NOW, counter("ev"));
    expect(retry).toBe(first);
    const changed = applyStageChange(
      { application: first.application, replies: [first.reply!], history },
      { ...request, toStage: "offer", chosenLabel: "offer" },
      NOW,
      counter("ev"),
    );
    expect(changed.ok).toBe(false);
    if (!changed.ok) expect(changed.code).toBe("conflict");
  });

  it("refuses stale revisions, already-confirmed replies and foreign replies", () => {
    const stale = applyStageChange(
      { application: application(), replies: [reply()], history: [] },
      { ...request, expectedRevision: 2 },
      NOW,
      counter("ev"),
    );
    expect(stale.ok === false && stale.code).toBe("stale");
    const confirmed = { ...reply(), chosenLabel: "rejection" as const, confirmedAt: NOW };
    const twice = applyStageChange({ application: application(), replies: [confirmed], history: [] }, request, NOW, counter("ev"));
    expect(twice.ok === false && twice.code).toBe("stale");
    const foreign = { ...reply(), applicationId: "app-2" };
    const wrong = applyStageChange({ application: application(), replies: [foreign], history: [] }, request, NOW, counter("ev"));
    expect(wrong.ok === false && wrong.code).toBe("invalid_input");
  });


  // what_bug_this_catches: a confirmed reply used to record "applied", downgrade, or move a withdrawn card.
  it("only allows the rule outcome for reply-driven moves", () => {
    const ack = { ...reply(), body: "We received your application." };
    const cases: Array<[Application["stage"], "acknowledgement" | "interview" | "offer", Application["stage"]]> = [
      ["approved", "acknowledgement", "applied"],
      ["interview", "acknowledgement", "saved"],
      ["withdrawn", "offer", "offer"],
      ["offer", "interview", "interview"],
    ];
    for (const [from, label, to] of cases) {
      const result = applyStageChange(
        { application: application(from), replies: [ack], history: [] },
        { ...request, toStage: to, chosenLabel: label },
        NOW,
        counter("ev"),
      );
      expect(result.ok === false && result.code, `${from} ${label} -> ${to}`).toBe("invalid_input");
    }
    const ok = applyStageChange(
      { application: application("approved"), replies: [ack], history: [] },
      { ...request, toStage: "approved", chosenLabel: "acknowledgement" },
      NOW,
      counter("ev"),
    );
    expect(ok.ok).toBe(true);
    const manual = applyStageChange(
      { application: application("rejected"), replies: [], history: [] },
      { ...request, toStage: "interview", replyId: null, chosenLabel: null },
      NOW,
      counter("ev"),
    );
    expect(manual.ok).toBe(true); // explicit manual resolution of a sticky rejection
    const unknown = applyStageChange(
      { application: application(), replies: [], history: [] },
      { ...request, toStage: "hired" as Application["stage"], replyId: null, chosenLabel: null },
      NOW,
      counter("ev"),
    );
    expect(unknown.ok === false && unknown.code).toBe("invalid_input");
  });
});

