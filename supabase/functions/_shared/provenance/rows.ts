// Pure mapping between database rows (supabase/migrations) and core domain types. Shared by the browser
// remote store and the draft-approve handler so both read the same shape. No client library imports.
import type {
  Application,
  Approval,
  EvidenceMapping,
  FactVersion,
  InputBinding,
  PacketRevision,
  PostingVersion,
  Reply,
  RequirementSet,
  RoleVersion,
  Skill,
  SkillEvidence,
  SourceDocumentVersion,
  StageEvent,
} from "./types.ts";

type Row = Record<string, unknown>;

const str = (value: unknown): string => (typeof value === "string" ? value : String(value ?? ""));
const strOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const num = (value: unknown): number => Number(value ?? 0);

export const TABLES = {
  sources: "source_versions",
  roles: "role_versions",
  facts: "fact_versions",
  skills: "skills",
  skillEvidence: "skill_evidence",
  postings: "posting_versions",
  applications: "applications",
  requirementSets: "requirement_sets",
  mappings: "evidence_mappings",
  packets: "packet_revisions",
  approvals: "approvals",
  replies: "replies",
  events: "stage_events",
  ownerState: "owner_state",
} as const;

export function sourceFromRow(row: Row): SourceDocumentVersion {
  return {
    documentId: str(row.document_id),
    versionId: str(row.version_id),
    title: str(row.title),
    body: str(row.body),
    sha256: str(row.sha256),
    createdAt: str(row.created_at),
  };
}

// The core orders versions by createdAt; the database orders decided versions by decided_at. Mapping the
// decision time into createdAt keeps both definitions of "current version" identical.
export function roleFromRow(row: Row): RoleVersion {
  return {
    roleId: str(row.role_id),
    versionId: str(row.version_id),
    employer: str(row.employer),
    title: str(row.title),
    start: str(row.start_month),
    end: strOrNull(row.end_month),
    current: Boolean(row.is_current),
    asOf: str(row.as_of),
    status: str(row.status) as RoleVersion["status"],
    approvedAt: strOrNull(row.approved_at),
    createdAt: str(row.decided_at ?? row.created_at),
  };
}

export function factFromRow(row: Row): FactVersion {
  const roleId = strOrNull(row.role_id);
  const roleVersionId = strOrNull(row.role_version_id);
  return {
    factId: str(row.fact_id),
    versionId: str(row.version_id),
    kind: str(row.kind) as FactVersion["kind"],
    text: str(row.body),
    roleRef: roleId && roleVersionId ? { roleId, roleVersionId } : null,
    projectLabel: strOrNull(row.project_label),
    status: str(row.status) as FactVersion["status"],
    origin: row.origin as FactVersion["origin"],
    approvedAt: strOrNull(row.approved_at),
    withdrawnAt: strOrNull(row.withdrawn_at),
    createdAt: str(row.decided_at ?? row.created_at),
  };
}

export function skillFromRow(row: Row): Skill {
  return { skillId: str(row.skill_id), canonical: str(row.canonical), aliases: (row.aliases as Skill["aliases"]) ?? [] };
}

export function skillEvidenceFromRow(row: Row): SkillEvidence {
  return {
    skillId: str(row.skill_id),
    factId: str(row.fact_id),
    factVersionId: str(row.fact_version_id),
    usage: (row.usage as SkillEvidence["usage"]) ?? [],
    attestedMonths: row.attested_months === null || row.attested_months === undefined ? null : num(row.attested_months),
  };
}

export function postingFromRow(row: Row): PostingVersion {
  return {
    postingId: str(row.posting_id),
    versionId: str(row.version_id),
    kind: "job",
    organisation: str(row.organisation),
    title: str(row.title),
    body: str(row.body),
    sha256: str(row.sha256),
    url: strOrNull(row.url),
    createdAt: str(row.created_at),
  };
}

export function applicationFromRow(row: Row): Application {
  return {
    applicationId: str(row.application_id),
    postingId: str(row.posting_id),
    stage: str(row.stage) as Application["stage"],
    revision: num(row.revision),
    notes: str(row.notes),
    selectedPacketId: strOrNull(row.selected_packet_id),
    selectedPacketRevision: row.selected_packet_revision === null || row.selected_packet_revision === undefined ? null : num(row.selected_packet_revision),
    updatedAt: str(row.updated_at),
  };
}

export function requirementSetFromRow(row: Row): RequirementSet {
  return {
    postingVersionId: str(row.posting_version_id),
    revision: num(row.revision),
    requirements: (row.requirements as RequirementSet["requirements"]) ?? [],
  };
}

export function mappingFromRow(row: Row): EvidenceMapping {
  return {
    postingVersionId: str(row.posting_version_id),
    requirementSetRevision: num(row.requirement_set_revision),
    revision: num(row.revision),
    evidence: (row.evidence as EvidenceMapping["evidence"]) ?? [],
  };
}

export function packetFromRow(row: Row): PacketRevision {
  return {
    packetId: str(row.packet_id),
    applicationId: str(row.application_id),
    postingVersionId: str(row.posting_version_id),
    revision: num(row.revision),
    parentRevision: row.parent_revision === null || row.parent_revision === undefined ? null : num(row.parent_revision),
    lines: (row.lines as PacketRevision["lines"]) ?? [],
    createdAt: str(row.created_at),
  };
}

export function approvalFromRow(row: Row): Approval {
  return {
    packetId: str(row.packet_id),
    revision: num(row.revision),
    renderedSha256: str(row.rendered_sha256),
    bindingSha256: str(row.binding_sha256),
    binding: row.binding as InputBinding,
    wordingAttested: Boolean(row.wording_attested),
    approvedAt: str(row.approved_at),
    source: "server",
  };
}

export function replyFromRow(row: Row): Reply {
  return {
    replyId: str(row.reply_id),
    applicationId: str(row.application_id),
    body: str(row.body),
    prediction: row.prediction as Reply["prediction"],
    chosenLabel: strOrNull(row.chosen_label) as Reply["chosenLabel"],
    confirmedAt: strOrNull(row.confirmed_at),
    createdAt: str(row.created_at),
  };
}

export function eventFromRow(row: Row): StageEvent {
  return {
    eventId: str(row.event_id),
    applicationId: str(row.application_id),
    fromStage: str(row.from_stage) as StageEvent["fromStage"],
    toStage: str(row.to_stage) as StageEvent["toStage"],
    replyId: strOrNull(row.reply_id),
    chosenLabel: strOrNull(row.chosen_label) as StageEvent["chosenLabel"],
    requestId: str(row.request_id),
    revision: num(row.revision),
    createdAt: str(row.created_at),
  };
}
