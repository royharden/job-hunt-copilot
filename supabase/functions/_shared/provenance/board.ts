import { digest } from "./hash.ts";
import { REPLY_LABELS, STAGES } from "./types.ts";
import type { Application, Reply, ReplyLabel, Stage, StageEvent } from "./types.ts";

// Stage rules (PLAN section 8). Approval means "ready", never "submitted"; the user records "applied".

export function stageAfterApproval(current: Stage): Stage {
  return current === "saved" || current === "preparing" ? "approved" : current;
}

// Suggested stage for a confirmed reply label. Withdrawn is immune; a rejection sticks until the user resolves
// it manually; acknowledgement never records "applied" and never downgrades interview/offer.
export function stageAfterReply(current: Stage, label: ReplyLabel): Stage {
  if (current === "withdrawn" || current === "rejected") return current;
  switch (label) {
    case "rejection":
      return "rejected";
    case "offer":
      return "offer";
    case "interview":
      return current === "offer" ? current : "interview";
    default:
      return current;
  }
}

export interface StageChangeRequest {
  applicationId: string;
  expectedRevision: number;
  toStage: Stage;
  replyId: string | null;
  chosenLabel: ReplyLabel | null;
  requestId: string;
}

export interface StageChangeRecord {
  requestId: string;
  fingerprint: string;
  result: StageChangeOk;
}

export interface StageChangeOk {
  ok: true;
  application: Application;
  event: StageEvent;
  reply: Reply | null;
}

export type StageChangeResult =
  | StageChangeOk
  | { ok: false; code: "conflict" | "stale" | "invalid_input" | "forbidden"; message: string };

export function stageRequestFingerprint(request: StageChangeRequest): string {
  return digest({
    operation: "apply_stage_change",
    applicationId: request.applicationId,
    expectedRevision: request.expectedRevision,
    toStage: request.toStage,
    replyId: request.replyId,
    chosenLabel: request.chosenLabel,
  });
}

// Pure model of the apply_stage_change transaction, used by the demo store and mirrored by the SQL RPC:
// confirm the reply (if any), change stage, bump revision and append one event, all or nothing.
// Same request_id + same payload returns the stored result; same request_id + different payload conflicts;
// an outdated expected revision is stale and needs a refresh and fresh confirmation.
export function applyStageChange(
  state: { application: Application; replies: Reply[]; history: StageChangeRecord[] },
  request: StageChangeRequest,
  now: string,
  newEventId: () => string,
): StageChangeResult {
  const fingerprint = stageRequestFingerprint(request);
  const prior = state.history.find((record) => record.requestId === request.requestId);
  if (prior) {
    return prior.fingerprint === fingerprint
      ? prior.result
      : { ok: false, code: "conflict", message: "This request id was already used with different details." };
  }
  if (!(STAGES as readonly string[]).includes(request.toStage)) {
    return { ok: false, code: "invalid_input", message: "Unknown stage." };
  }
  if (request.chosenLabel !== null && !(REPLY_LABELS as readonly string[]).includes(request.chosenLabel)) {
    return { ok: false, code: "invalid_input", message: "Unknown reply label." };
  }
  if (request.applicationId !== state.application.applicationId) {
    return { ok: false, code: "forbidden", message: "Application does not match." };
  }
  if (request.expectedRevision !== state.application.revision) {
    return { ok: false, code: "stale", message: "The board changed since you looked. Refresh and confirm again." };
  }
  let reply: Reply | null = null;
  if (request.replyId !== null) {
    const found = state.replies.find((item) => item.replyId === request.replyId);
    if (!found || found.applicationId !== request.applicationId) {
      return { ok: false, code: "invalid_input", message: "Reply does not belong to this application." };
    }
    if (found.confirmedAt !== null) {
      return { ok: false, code: "stale", message: "This reply was already confirmed." };
    }
    if (request.chosenLabel === null) {
      return { ok: false, code: "invalid_input", message: "Choose a label to confirm the reply." };
    }
    // A reply-driven move must be exactly the rule outcome: withdrawn is immune, rejection sticks, an
    // acknowledgement never records "applied" or downgrades. Other moves are explicit manual resolutions
    // made without a reply.
    const expected = stageAfterReply(state.application.stage, request.chosenLabel);
    if (request.toStage !== expected) {
      return {
        ok: false,
        code: "invalid_input",
        message: `A confirmed ${request.chosenLabel} reply moves this application to "${expected}". Change other stages manually.`,
      };
    }
    reply = { ...found, chosenLabel: request.chosenLabel, confirmedAt: now };
  } else if (request.chosenLabel !== null) {
    return { ok: false, code: "invalid_input", message: "A label needs a reply." };
  }
  const application: Application = {
    ...state.application,
    stage: request.toStage,
    revision: state.application.revision + 1,
    updatedAt: now,
  };
  const event: StageEvent = {
    eventId: newEventId(),
    applicationId: application.applicationId,
    fromStage: state.application.stage,
    toStage: request.toStage,
    replyId: request.replyId,
    chosenLabel: request.chosenLabel,
    requestId: request.requestId,
    revision: application.revision,
    createdAt: now,
  };
  return { ok: true, application, event, reply };
}
