import { LIMITS } from "../../supabase/functions/_shared/provenance/limits.ts";
import { normalizeWhitespace } from "../../supabase/functions/_shared/provenance/normalize.ts";
import {
  CONFIRMED_TIERS,
  FACT_KINDS,
  PACKET_SECTIONS,
  REPLY_LABELS,
  REQUIREMENT_FLAGS,
  STAGES,
  TEMPLATE_IDS,
} from "../../supabase/functions/_shared/provenance/types.ts";
import type { PacketLine, ReplyLabel, Stage } from "../../supabase/functions/_shared/provenance/types.ts";
import { parseMonth } from "../../supabase/functions/_shared/provenance/versions.ts";
import { RepoError, type EvidenceDecision, type NewFact, type NewPosting, type NewRole, type RequirementEdit } from "./repository.ts";

// Input validation shared by both adapters. The database repeats shape/length constraints; the server
// repeats every authority check. Passing these checks confers no authority.

function fail(message: string): never {
  throw new RepoError("invalid_input", message);
}

function text(value: unknown, name: string, min: number, max: number): string {
  if (typeof value !== "string") fail(`${name} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) fail(`${name} must be ${min} to ${max} characters.`);
  return trimmed;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  return fail(`Unexpected ${name}.`);
}

export function cleanSource(title: string, body: string): { title: string; body: string } {
  return { title: text(title, "Title", 1, LIMITS.titleChars), body: text(body, "Source text", 1, LIMITS.sourceChars) };
}

export function cleanRole(input: NewRole): NewRole {
  const employer = text(input.employer, "Employer", 1, LIMITS.titleChars);
  const title = text(input.title, "Title", 1, LIMITS.titleChars);
  const start = input.start.trim();
  const asOf = input.asOf.trim();
  const end = input.current ? null : (input.end ?? "").trim();
  if (parseMonth(start) === null) fail("Start must be YYYY-MM.");
  if (parseMonth(asOf) === null) fail("As-of month must be YYYY-MM.");
  if (!input.current) {
    if (!end || parseMonth(end) === null) fail("End must be YYYY-MM, or mark the role current.");
    if (parseMonth(end)! < parseMonth(start)!) fail("End must not be before start.");
  }
  return { roleId: input.roleId, employer, title, start, end, current: input.current, asOf };
}

export function cleanFact(input: NewFact): NewFact {
  const kind = oneOf(input.kind, FACT_KINDS, "fact kind");
  const factText = normalizeWhitespace(text(input.text, "Statement", 1, LIMITS.factTextChars));
  const projectLabel = input.projectLabel && input.projectLabel.trim().length > 0 ? text(input.projectLabel, "Project", 1, 80) : null;
  if (input.origin.type === "user_attestation") {
    const statement = text(input.origin.statement, "Attestation", 1, LIMITS.factTextChars);
    return { ...input, kind, text: factText, projectLabel, origin: { type: "user_attestation", statement } };
  }
  const { start, end } = input.origin;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) fail("Select a span of the source text.");
  return { ...input, kind, text: factText, projectLabel };
}

export function cleanPosting(input: NewPosting): NewPosting {
  return {
    organisation: text(input.organisation, "Organisation", 1, LIMITS.titleChars),
    title: text(input.title, "Title", 1, LIMITS.titleChars),
    body: text(input.body, "Posting text", 1, LIMITS.postingChars),
    url: input.url && input.url.trim().length > 0 ? text(input.url, "URL", 1, 2_000) : null,
  };
}

export function cleanRequirementEdits(edits: RequirementEdit[]): RequirementEdit[] {
  if (!Array.isArray(edits) || edits.length > LIMITS.requirementsPerPosting * 2) fail("Too many requirements.");
  return edits.map((edit) => ({
    ...edit,
    clause: normalizeWhitespace(text(edit.clause, "Requirement", 1, LIMITS.requirementChars)),
    priority: oneOf(edit.priority, ["required", "preferred"] as const, "priority"),
    flags: [...new Set(edit.flags.map((flag) => oneOf(flag, REQUIREMENT_FLAGS, "flag")))],
    reviewed: Boolean(edit.reviewed),
    removed: Boolean(edit.removed),
  }));
}

export function cleanDecision(decision: EvidenceDecision | null): EvidenceDecision | null {
  if (decision === null) return null;
  const tier = oneOf(decision.tier, CONFIRMED_TIERS, "confirmation");
  const all = Array.isArray(decision.facts) ? decision.facts : [];
  const facts = all.filter((ref, index) => all.findIndex((other) => other.versionId === ref.versionId) === index);
  if (tier === "gap" && facts.length > 0) fail("A gap has no evidence.");
  if (tier !== "gap" && facts.length === 0) fail("Pick the approved sentence that supports this requirement.");
  if (facts.length > 8) fail("Too many sentences for one requirement.");
  return { tier, facts, reason: text(decision.reason || tier, "Reason", 1, 300) };
}

export function cleanLines(lines: PacketLine[]): PacketLine[] {
  if (!Array.isArray(lines) || lines.length > LIMITS.packetLines) fail(`A packet holds at most ${LIMITS.packetLines} lines.`);
  const ids = new Set<string>();
  return lines.map((line) => {
    const lineId = text(line.lineId, "Line id", 1, 80);
    if (ids.has(lineId)) fail("Duplicate line id.");
    ids.add(lineId);
    const section = oneOf(line.section, PACKET_SECTIONS, "section");
    const proposalText = text(line.proposalText, "Line", 1, LIMITS.lineChars);
    const requirementIds = Array.isArray(line.requirementIds) ? line.requirementIds.slice(0, 20).map(String) : [];
    if (line.kind === "fact") {
      return { lineId, section, kind: "fact", fact: { factId: String(line.fact.factId), versionId: String(line.fact.versionId) }, proposalText, requirementIds };
    }
    if (line.kind !== "template") fail("Unknown line kind.");
    return {
      lineId,
      section,
      kind: "template",
      templateId: oneOf(line.templateId, TEMPLATE_IDS, "template"),
      role: line.role ? { roleId: String(line.role.roleId), roleVersionId: String(line.role.roleVersionId) } : null,
      proposalText,
      requirementIds,
    };
  });
}

export function cleanReplyBody(body: string): string {
  return text(body, "Reply", 1, LIMITS.replyChars);
}

export function requireStage(value: string): Stage {
  return oneOf(value, STAGES, "stage");
}

export function requireReplyLabel(value: string): ReplyLabel {
  return oneOf(value, REPLY_LABELS, "reply label");
}
