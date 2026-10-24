import { LIMITS } from "../../supabase/functions/_shared/provenance/limits.ts";
import {
  BOARD_STATUSES,
  FACT_KINDS,
  POSTING_KINDS,
  REPLY_LABELS,
} from "../../supabase/functions/_shared/provenance/types.ts";
import type { BoardStatus, FactKind, PostingKind, ReplyLabel } from "../../supabase/functions/_shared/provenance/types.ts";
import type { NewFact, NewPosting, NewReply } from "./repository.ts";

export function requireFactKind(value: string): FactKind {
  if ((FACT_KINDS as readonly string[]).includes(value)) return value as FactKind;
  throw new Error(`Unexpected fact kind: ${value}`);
}

export function requirePostingKind(value: string): PostingKind {
  if ((POSTING_KINDS as readonly string[]).includes(value)) return value as PostingKind;
  throw new Error(`Unexpected posting kind: ${value}`);
}

export function requireBoardStatus(value: string): BoardStatus {
  if ((BOARD_STATUSES as readonly string[]).includes(value)) return value as BoardStatus;
  throw new Error(`Unexpected board status: ${value}`);
}

export function requireReplyLabel(value: string): ReplyLabel {
  if ((REPLY_LABELS as readonly string[]).includes(value)) return value as ReplyLabel;
  throw new Error(`Unexpected reply label: ${value}`);
}

export function cleanFact(input: NewFact): { kind: FactKind; surface: string; text: string } {
  const kind = requireFactKind(input.kind);
  const surface = input.surface.trim();
  const text = input.text.trim();
  if (surface.length < LIMITS.factSurfaceMin || surface.length > LIMITS.factSurfaceChars) {
    throw new Error("The surface form must be 2 to 200 characters.");
  }
  if (text.length < 1 || text.length > LIMITS.factTextChars) {
    throw new Error("The fact must be 1 to 2000 characters.");
  }
  return { kind, surface, text };
}

export function cleanPosting(input: NewPosting): NewPosting {
  const kind = requirePostingKind(input.kind);
  const title = input.title.trim();
  const organization = input.organization.trim();
  const text = input.text.trim();
  if (title.length < 1 || title.length > 200) throw new Error("Title must be 1 to 200 characters.");
  if (organization.length < 1 || organization.length > 200) {
    throw new Error("Organization must be 1 to 200 characters.");
  }
  if (text.length < 1 || text.length > LIMITS.postingChars) {
    throw new Error("Posting text must be 1 to 20000 characters.");
  }
  return { kind, title, organization, text };
}

export function cleanReply(input: NewReply): NewReply {
  const text = input.text.trim();
  if (text.length < 1 || text.length > LIMITS.emailChars) {
    throw new Error("Paste an email of 1 to 20000 characters.");
  }
  return {
    applicationId: input.applicationId,
    text,
    predictedLabel: requireReplyLabel(input.predictedLabel),
    confidence: input.confidence,
    needsReview: input.needsReview,
  };
}
