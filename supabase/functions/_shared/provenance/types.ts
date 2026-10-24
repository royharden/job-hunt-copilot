// Domain contract shared by the browser preview, the demo store, the edge handler and tests.
// Pure types and constant lists only. No browser, Deno or npm imports.

export const FACT_KINDS = [
  "accomplishment",
  "responsibility",
  "skill_usage",
  "education",
  "credential",
  "project",
  "preference",
  "other",
] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const FACT_STATUSES = ["draft", "approved", "withdrawn"] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

// Character offsets are JavaScript UTF-16 code units into the exact source version body.
export interface SourceSpanOrigin {
  type: "source_span";
  documentId: string;
  documentVersionId: string;
  documentSha256: string;
  start: number;
  end: number;
  quote: string;
}

export interface UserAttestationOrigin {
  type: "user_attestation";
  statement: string;
  attestedAt: string;
}

export type Origin = SourceSpanOrigin | UserAttestationOrigin;

export interface SourceDocumentVersion {
  documentId: string;
  versionId: string;
  title: string;
  body: string;
  sha256: string;
  createdAt: string;
}

export interface RoleVersion {
  roleId: string;
  versionId: string;
  employer: string;
  title: string;
  start: string; // YYYY-MM
  end: string | null; // YYYY-MM, null when current
  current: boolean;
  asOf: string; // YYYY-MM month the role data was last confirmed
  status: FactStatus;
  approvedAt: string | null;
  createdAt: string;
}

export interface RoleRef {
  roleId: string;
  roleVersionId: string;
}

export interface FactVersion {
  factId: string;
  versionId: string;
  kind: FactKind;
  text: string;
  roleRef: RoleRef | null;
  projectLabel: string | null;
  status: FactStatus;
  origin: Origin;
  approvedAt: string | null;
  withdrawnAt: string | null;
  createdAt: string;
}

export interface SkillAlias {
  alias: string;
  approved: boolean;
}

export interface Skill {
  skillId: string;
  canonical: string;
  aliases: SkillAlias[];
}

export interface UsageInterval {
  start: string; // YYYY-MM
  end: string; // YYYY-MM
}

export interface SkillEvidence {
  skillId: string;
  factId: string;
  factVersionId: string;
  usage: UsageInterval[];
  attestedMonths: number | null;
}

export interface Profile {
  sources: SourceDocumentVersion[];
  roles: RoleVersion[];
  facts: FactVersion[];
  skills: Skill[];
  skillEvidence: SkillEvidence[];
}

// Postings and requirements.

export const POSTING_KINDS = ["job"] as const;
export type PostingKind = (typeof POSTING_KINDS)[number];

export interface PostingVersion {
  postingId: string;
  versionId: string;
  kind: PostingKind;
  organisation: string;
  title: string;
  body: string;
  sha256: string;
  url: string | null;
  createdAt: string;
}

export const REQUIREMENT_FLAGS = [
  "years",
  "credential",
  "negation",
  "condition",
  "benefit",
  "proficiency",
  "mixed",
] as const;
export type RequirementFlag = (typeof REQUIREMENT_FLAGS)[number];

export type Priority = "required" | "preferred";

export interface QuoteSpan {
  start: number;
  end: number;
  text: string;
}

export interface RequirementVersion {
  requirementId: string;
  versionId: string;
  postingVersionId: string;
  ordinal: number;
  quote: QuoteSpan | null; // original posting text; null only for a clause the user typed
  clause: string; // edited clause; never highlighted as original
  priority: Priority;
  flags: RequirementFlag[];
  reviewed: boolean;
  removed: boolean;
}

export interface RequirementSet {
  postingVersionId: string;
  revision: number;
  requirements: RequirementVersion[];
}

export const PROPOSAL_TIERS = ["exact", "lexical", "partial", "gap"] as const;
export type ProposalTier = (typeof PROPOSAL_TIERS)[number];

export const CONFIRMED_TIERS = ["direct", "partial", "gap"] as const;
export type ConfirmedTier = (typeof CONFIRMED_TIERS)[number];

export interface FactRef {
  factId: string;
  versionId: string;
}

export interface EvidenceProposal {
  fact: FactRef;
  tier: Exclude<ProposalTier, "gap">;
  reason: string;
}

export interface RequirementEvidence {
  requirementId: string;
  requirementVersionId: string;
  proposals: EvidenceProposal[];
  proposedTier: ProposalTier;
  confirmed: {
    tier: ConfirmedTier;
    facts: FactRef[];
    reason: string;
    confirmedAt: string;
  } | null;
}

export interface EvidenceMapping {
  postingVersionId: string;
  requirementSetRevision: number;
  revision: number;
  evidence: RequirementEvidence[];
}

// Packets.

export const PACKET_SECTIONS = ["opening", "experience", "education", "skills", "closing"] as const;
export type PacketSection = (typeof PACKET_SECTIONS)[number];

export const TEMPLATE_IDS = ["role_header", "application_opening", "generic_closing"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export interface FactLine {
  lineId: string;
  section: PacketSection;
  kind: "fact";
  fact: FactRef;
  proposalText: string;
  requirementIds: string[];
}

export interface TemplateLine {
  lineId: string;
  section: PacketSection;
  kind: "template";
  templateId: TemplateId;
  role: RoleRef | null; // role_header only
  proposalText: string;
  requirementIds: string[];
}

export type PacketLine = FactLine | TemplateLine;

export interface PacketRevision {
  packetId: string;
  applicationId: string;
  postingVersionId: string;
  revision: number;
  parentRevision: number | null;
  lines: PacketLine[];
  createdAt: string;
}

export const GRADES = ["verified", "unchecked", "blocked", "reverted", "checked"] as const;
export type Grade = (typeof GRADES)[number];

export interface Finding {
  code: string;
  detail: string;
}

export interface SourceRef {
  kind: "fact" | "role" | "posting";
  id: string;
  versionId: string;
  quote: string;
}

export interface RenderedLine {
  lineId: string;
  section: PacketSection;
  proposalText: string;
  text: string; // server/code rendering; empty unless verified
  grade: Grade;
  findings: Finding[];
  sources: SourceRef[];
  fallback: { text: string; fact: FactRef | null } | null; // whole source sentence or the unedited template
  requirementIds: string[];
}

// Approval binding (PLAN section 5).
export interface InputBinding {
  applicationId: string;
  postingVersionId: string;
  postingSha256: string;
  requirementSetRevision: number;
  mappingRevision: number;
  factVersionIds: string[];
  roleVersionIds: string[];
  sourceVersionIds: string[];
  aliasDigest: string;
  tenureDigest: string;
  packetId: string;
  packetRevision: number;
  lineOrder: string[];
  templates: string[];
  renderedSha256: string;
  guardVersion: string;
  templateVersion: string;
}

export interface Approval {
  packetId: string;
  revision: number;
  renderedSha256: string;
  bindingSha256: string;
  binding: InputBinding;
  wordingAttested: boolean;
  approvedAt: string;
  source: "server" | "demo_local";
}

// Board and replies.

export const STAGES = [
  "saved",
  "preparing",
  "approved",
  "applied",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
] as const;
export type Stage = (typeof STAGES)[number];

export const REPLY_LABELS = [
  "rejection",
  "interview",
  "offer",
  "acknowledgement",
  "not_applicable",
  "unknown",
] as const;
export type ReplyLabel = (typeof REPLY_LABELS)[number];

export type EvidenceStrength = "strong" | "weak" | "none";

export interface RuleHit {
  ruleId: string;
  label: ReplyLabel;
  start: number;
  end: number;
  text: string;
  ignored: string | null; // why the hit does not count (quoted, negated, ...)
}

export interface ReplyPrediction {
  label: ReplyLabel;
  needsReview: boolean;
  strength: EvidenceStrength;
  hits: RuleHit[];
  reasons: string[];
  rulesVersion: string;
}

export interface Application {
  applicationId: string;
  postingId: string;
  stage: Stage;
  revision: number;
  notes: string;
  selectedPacketId: string | null;
  selectedPacketRevision: number | null;
  updatedAt: string;
}

export interface Reply {
  replyId: string;
  applicationId: string;
  body: string;
  prediction: ReplyPrediction;
  chosenLabel: ReplyLabel | null;
  confirmedAt: string | null;
  createdAt: string;
}

export interface StageEvent {
  eventId: string;
  applicationId: string;
  fromStage: Stage;
  toStage: Stage;
  replyId: string | null;
  chosenLabel: ReplyLabel | null;
  requestId: string;
  revision: number;
  createdAt: string;
}
