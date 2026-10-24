import type {
  BoardStatus,
  CoverLine,
  DraftBullet,
  DraftSource,
  Fact,
  FactKind,
  GateReport,
  PostingKind,
  ReplyLabel,
  RequirementMatch,
} from "../../supabase/functions/_shared/provenance/types.ts";

export interface FactRecord extends Fact {
  createdAt: string;
}

export interface PostingRecord {
  id: string;
  kind: PostingKind;
  title: string;
  organization: string;
  text: string;
  createdAt: string;
}

export interface DraftRecord {
  id: string;
  postingId: string;
  source: DraftSource;
  model: string | null;
  bullets: DraftBullet[];
  cover: CoverLine[];
  gate: GateReport;
  approvable: boolean;
  approvedAt: string | null;
  createdAt: string;
}

export interface ApplicationRecord {
  id: string;
  postingId: string;
  draftId: string | null;
  boardStatus: BoardStatus;
  updatedAt: string;
}

export interface ReplyRecord {
  id: string;
  applicationId: string;
  text: string;
  predictedLabel: ReplyLabel;
  confidence: number;
  needsReview: boolean;
  confirmedLabel: ReplyLabel | null;
  createdAt: string;
}

export interface NewFact {
  kind: FactKind;
  surface: string;
  text: string;
}

export interface NewPosting {
  kind: PostingKind;
  title: string;
  organization: string;
  text: string;
}

export interface NewDraft {
  postingId: string;
  source: DraftSource;
  model: string | null;
  bullets: DraftBullet[];
  cover: CoverLine[];
  gate: GateReport;
  approvable: boolean;
}

export interface NewReply {
  applicationId: string;
  text: string;
  predictedLabel: ReplyLabel;
  confidence: number;
  needsReview: boolean;
}

export type ModelDraftResult =
  | { ok: true; draft: DraftRecord }
  | { ok: false; message: string };

export interface HuntRepository {
  mode: "demo" | "remote";
  listFacts(): Promise<FactRecord[]>;
  createFact(input: NewFact): Promise<FactRecord>;
  deleteFact(id: string): Promise<void>;
  loadSampleFacts(): Promise<void>;
  removeSampleFacts(): Promise<void>;
  listPostings(): Promise<PostingRecord[]>;
  createPosting(input: NewPosting): Promise<PostingRecord>;
  listMatches(postingId: string): Promise<RequirementMatch[]>;
  replaceMatches(postingId: string, matches: RequirementMatch[]): Promise<void>;
  listDrafts(postingId: string): Promise<DraftRecord[]>;
  saveDraft(input: NewDraft): Promise<DraftRecord>;
  approveDraft(id: string): Promise<void>;
  listApplications(): Promise<ApplicationRecord[]>;
  setBoardStatus(id: string, status: BoardStatus): Promise<void>;
  listReplies(applicationId: string): Promise<ReplyRecord[]>;
  saveReply(input: NewReply): Promise<ReplyRecord>;
  confirmReply(id: string, label: ReplyLabel): Promise<void>;
  requestModelDraft(postingId: string): Promise<ModelDraftResult>;
}
