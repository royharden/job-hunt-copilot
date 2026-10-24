import type { StageChangeRequest, StageChangeResult } from "../../supabase/functions/_shared/provenance/board.ts";
import type { RepairAction } from "../../supabase/functions/_shared/provenance/health.ts";
import type {
  Application,
  Approval,
  ConfirmedTier,
  EvidenceMapping,
  FactKind,
  FactRef,
  PacketLine,
  PacketRevision,
  PostingVersion,
  Profile,
  RenderedLine,
  Reply,
  RequirementSet,
  RequirementVersion,
  RoleRef,
  StageEvent,
  UsageInterval,
} from "../../supabase/functions/_shared/provenance/types.ts";

// One typed API for both adapters. The demo adapter runs everything locally in browser storage; the remote
// adapter calls owner-checked database RPCs and the draft-approve function. Neither adapter lets the client
// write grades, approvals, stage/revision, confirmed replies or events directly.

export interface Workspace {
  profile: Profile;
  postings: PostingVersion[];
  requirementSets: RequirementSet[];
  mappings: EvidenceMapping[];
  applications: Application[];
  packets: PacketRevision[];
  approvals: Approval[];
  replies: Reply[];
  events: StageEvent[];
}

export interface NewRole {
  roleId: string | null; // null creates a new role; otherwise a new version of that role
  employer: string;
  title: string;
  start: string;
  end: string | null;
  current: boolean;
  asOf: string;
}

export type NewFactOrigin =
  | { type: "source_span"; documentId: string; documentVersionId: string; start: number; end: number }
  | { type: "user_attestation"; statement: string };

export interface NewFact {
  factId: string | null; // null creates a new fact; otherwise a new draft version of that fact
  kind: FactKind;
  text: string;
  roleRef: RoleRef | null;
  projectLabel: string | null;
  origin: NewFactOrigin;
}

export interface NewPosting {
  organisation: string;
  title: string;
  body: string;
  url: string | null;
}

export interface RequirementEdit {
  requirementId: string | null; // null for a user-split or user-added clause
  quote: RequirementVersion["quote"];
  clause: string;
  priority: RequirementVersion["priority"];
  flags: RequirementVersion["flags"];
  reviewed: boolean;
  removed: boolean;
}

export interface EvidenceDecision {
  tier: ConfirmedTier;
  facts: FactRef[];
  reason: string;
}

export interface ApproveResult {
  approval: Approval;
  lines: RenderedLine[];
  export: { plainText: string; markdown: string };
  receipt: "server" | "demo_local";
}

export type RepoErrorCode = "unauthorized" | "forbidden" | "invalid_input" | "missing_config" | "blocked" | "conflict" | "stale" | "unavailable";

export class RepoError extends Error {
  readonly code: RepoErrorCode;
  constructor(code: RepoErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface HuntRepository {
  mode: "demo" | "remote";
  load(): Promise<Workspace>;

  addSource(title: string, body: string): Promise<void>;
  saveRole(input: NewRole): Promise<void>;
  approveRole(roleId: string, versionId: string): Promise<void>;
  withdrawRole(roleId: string): Promise<void>;
  saveFact(input: NewFact): Promise<void>;
  approveFact(factId: string, versionId: string): Promise<void>;
  withdrawFact(factId: string): Promise<void>;
  saveSkill(skillId: string | null, canonical: string, aliases: Array<{ alias: string; approved: boolean }>): Promise<void>;
  linkSkill(skillId: string, fact: FactRef, usage: UsageInterval[], attestedMonths: number | null): Promise<void>;
  unlinkSkill(skillId: string, factId: string, factVersionId: string): Promise<void>;
  applyRepair(repair: RepairAction): Promise<void>;

  createPosting(input: NewPosting): Promise<{ postingId: string; applicationId: string }>;
  saveRequirements(postingVersionId: string, expectedRevision: number, edits: RequirementEdit[]): Promise<void>;
  confirmEvidence(
    postingVersionId: string,
    expectedMappingRevision: number,
    requirementId: string,
    decision: EvidenceDecision | null,
  ): Promise<void>;
  refreshProposals(postingVersionId: string): Promise<void>;

  savePacketRevision(applicationId: string, packetId: string | null, expectedRevision: number | null, lines: PacketLine[]): Promise<PacketRevision>;
  approvePacket(packetId: string, revision: number, expectedRenderedSha256: string | null, requestId: string): Promise<ApproveResult>;

  addReply(applicationId: string, body: string): Promise<Reply>;
  applyStageChange(request: StageChangeRequest): Promise<StageChangeResult>;
  saveNotes(applicationId: string, notes: string): Promise<void>;
}
