import { sha256Hex } from "./hash.ts";
import type {
  FactRef,
  FactVersion,
  Origin,
  Profile,
  RoleRef,
  RoleVersion,
  SourceDocumentVersion,
} from "./types.ts";

// Versions are append-only. The current version of a fact or role is its newest version by createdAt
// (ties broken by versionId). It is usable evidence only when that newest version is approved; a newer
// draft does not hide the approved one, but a newer withdrawal does.

function newestFirst<T extends { createdAt: string; versionId: string }>(items: T[]): T[] {
  return [...items].sort((left, right) =>
    left.createdAt === right.createdAt
      ? right.versionId.localeCompare(left.versionId)
      : right.createdAt.localeCompare(left.createdAt),
  );
}

export function currentFactVersion(facts: FactVersion[], factId: string): FactVersion | null {
  const versions = newestFirst(facts.filter((fact) => fact.factId === factId && fact.status !== "draft"));
  const newest = versions[0];
  return newest && newest.status === "approved" ? newest : null;
}

export function currentFacts(profile: Pick<Profile, "facts">): FactVersion[] {
  const ids = [...new Set(profile.facts.map((fact) => fact.factId))];
  return ids.map((id) => currentFactVersion(profile.facts, id)).filter((fact): fact is FactVersion => fact !== null);
}

export function isCurrentFact(profile: Pick<Profile, "facts">, ref: FactRef): boolean {
  const current = currentFactVersion(profile.facts, ref.factId);
  return current !== null && current.versionId === ref.versionId;
}

export function findFactVersion(profile: Pick<Profile, "facts">, ref: FactRef): FactVersion | null {
  return profile.facts.find((fact) => fact.factId === ref.factId && fact.versionId === ref.versionId) ?? null;
}

export function currentRoleVersion(roles: RoleVersion[], roleId: string): RoleVersion | null {
  const versions = newestFirst(roles.filter((role) => role.roleId === roleId && role.status !== "draft"));
  const newest = versions[0];
  return newest && newest.status === "approved" ? newest : null;
}

export function isCurrentRole(profile: Pick<Profile, "roles">, ref: RoleRef): boolean {
  const current = currentRoleVersion(profile.roles, ref.roleId);
  return current !== null && current.versionId === ref.roleVersionId;
}

export function findRoleVersion(profile: Pick<Profile, "roles">, ref: RoleRef): RoleVersion | null {
  return profile.roles.find((role) => role.roleId === ref.roleId && role.versionId === ref.roleVersionId) ?? null;
}

export function findSource(profile: Pick<Profile, "sources">, documentId: string, versionId: string): SourceDocumentVersion | null {
  return profile.sources.find((doc) => doc.documentId === documentId && doc.versionId === versionId) ?? null;
}

// Span check on save: exact source version, matching hash, in-range UTF-16 offsets, identical quote.
export function checkOrigin(profile: Pick<Profile, "sources">, origin: Origin): string | null {
  if (origin.type === "user_attestation") {
    return origin.statement.trim().length === 0 ? "Attestation statement is empty." : null;
  }
  const doc = findSource(profile, origin.documentId, origin.documentVersionId);
  if (!doc) return "Source document version not found.";
  if (doc.sha256 !== origin.documentSha256) return "Source hash does not match the cited version.";
  if (sha256Hex(doc.body) !== doc.sha256) return "Source body does not match its stored hash.";
  if (!Number.isInteger(origin.start) || !Number.isInteger(origin.end)) return "Span offsets must be integers.";
  if (origin.start < 0 || origin.end <= origin.start || origin.end > doc.body.length) return "Span is out of range.";
  if (doc.body.slice(origin.start, origin.end) !== origin.quote) return "Quoted text does not match the source span.";
  return null;
}

// YYYY-MM helpers. Months are counted as integers (year * 12 + month - 1).
export function parseMonth(value: string): number | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

export function formatMonth(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function roleDates(role: RoleVersion): string {
  return `${role.start} to ${role.current || role.end === null ? "present" : role.end}`;
}
