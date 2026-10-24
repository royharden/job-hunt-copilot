export const FACT_KINDS = [
  "employer",
  "title",
  "skill",
  "tool",
  "metric",
  "date",
  "education",
  "project",
  "accomplishment",
  "eligibility",
] as const;

export type FactKind = (typeof FACT_KINDS)[number];

export const POSTING_KINDS = ["job", "scholarship", "fellowship"] as const;

export type PostingKind = (typeof POSTING_KINDS)[number];

export const MATCH_LABELS = ["exact", "lexical", "gap"] as const;

export type MatchLabel = (typeof MATCH_LABELS)[number];

export const BOARD_STATUSES = [
  "draft",
  "approved",
  "applied",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
] as const;

export type BoardStatus = (typeof BOARD_STATUSES)[number];

export const REPLY_LABELS = [
  "rejected",
  "offer",
  "interview",
  "acknowledgement",
  "not_applicable",
  "unknown",
] as const;

export type ReplyLabel = (typeof REPLY_LABELS)[number];

export const DRAFT_SOURCES = ["local_restatement", "model"] as const;

export type DraftSource = (typeof DRAFT_SOURCES)[number];

export interface Fact {
  id: string;
  kind: FactKind;
  surface: string;
  text: string;
}

export interface RequirementMatch {
  id: string;
  postingId: string;
  ordinal: number;
  text: string;
  label: MatchLabel;
  supportFactIds: string[];
  reason: string;
}

export interface DraftBullet {
  text: string;
  factIds: string[];
}

export interface CoverLine {
  heading: string;
  text: string;
  factIds: string[];
}

export type GateAction = "pass" | "revert" | "drop";

export interface GateLineResult {
  index: number;
  action: GateAction;
  originalText: string;
  text: string;
  factIds: string[];
  reasons: string[];
  heading?: string;
}

export interface GateReport {
  bullets: GateLineResult[];
  cover: GateLineResult[];
  passed: number;
  reverted: number;
  dropped: number;
}

export interface Classification {
  label: ReplyLabel;
  confidence: number;
  needsReview: boolean;
  hits: string[];
}
