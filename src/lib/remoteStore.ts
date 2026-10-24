import type { SupabaseClient } from "@supabase/supabase-js";
import type { StageChangeRequest, StageChangeResult } from "../../supabase/functions/_shared/provenance/board.ts";
import { classifyReply } from "../../supabase/functions/_shared/provenance/classify.ts";
import { extractRequirements } from "../../supabase/functions/_shared/provenance/extract.ts";
import { digest } from "../../supabase/functions/_shared/provenance/hash.ts";
import type { RepairAction } from "../../supabase/functions/_shared/provenance/health.ts";
import { proposeEvidence } from "../../supabase/functions/_shared/provenance/match.ts";
import { normalizeWhitespace } from "../../supabase/functions/_shared/provenance/normalize.ts";
import {
  TABLES,
  applicationFromRow,
  approvalFromRow,
  eventFromRow,
  factFromRow,
  mappingFromRow,
  packetFromRow,
  postingFromRow,
  replyFromRow,
  requirementSetFromRow,
  roleFromRow,
  skillEvidenceFromRow,
  skillFromRow,
  sourceFromRow,
} from "../../supabase/functions/_shared/provenance/rows.ts";
import type { PacketLine, RenderedLine, RequirementVersion, UsageInterval } from "../../supabase/functions/_shared/provenance/types.ts";
import { checkOrigin, isCurrentFact } from "../../supabase/functions/_shared/provenance/versions.ts";
import { newId } from "./demoStore.ts";
import { confirmInEvidence, nextRequirements } from "./edits.ts";
import {
  RepoError,
  type ApproveResult,
  type HuntRepository,
  type NewFact,
  type NewPosting,
  type NewRole,
  type RepoErrorCode,
  type RequirementEdit,
  type Workspace,
} from "./repository.ts";
import {
  cleanDecision,
  cleanFact,
  cleanLines,
  cleanPosting,
  cleanReplyBody,
  cleanRequirementEdits,
  cleanRole,
  cleanSource,
} from "./validate.ts";
import { latestMapping, latestPostingVersion, latestRequirementSet } from "./workspace.ts";

// Live adapter. Row-level security limits every read to the signed-in owner. Draft profile rows are inserted
// directly; every authority-bearing change goes through an owner-checked RPC, and packet approval goes
// through the draft-approve edge function. Browser-side computations here are proposals the server
// re-validates; none of them is trusted as authority.

interface DbError {
  message: string;
  code?: string;
}

function repoError(error: DbError): RepoError {
  const prefix = /^(unauthorized|forbidden|invalid_input|stale|conflict|blocked|unavailable|missing_config)\b/.exec(error.message)?.[1];
  const byCode: Record<string, RepoErrorCode> = {
    "28000": "unauthorized",
    "42501": "forbidden",
    "22023": "invalid_input",
    "23514": "invalid_input",
    "23502": "invalid_input",
    "40001": "stale",
    "23505": "conflict",
    "23503": "forbidden",
  };
  const code = (prefix as RepoErrorCode | undefined) ?? (error.code ? byCode[error.code] : undefined) ?? "unavailable";
  return new RepoError(code, error.message.replace(/^\w+:\s*/, "") || "Request failed.");
}

async function check<T>(promise: PromiseLike<{ data: T; error: DbError | null }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw repoError(error);
  return data;
}

export function createRemoteStore(client: SupabaseClient, userId: string): HuntRepository {
  let cache: Workspace | null = null;

  async function load(): Promise<Workspace> {
    const select = (table: string) => check(client.from(table).select("*")) as Promise<Array<Record<string, unknown>>>;
    const [sources, roles, facts, skills, links, postings, applications, sets, mappings, packets, approvals, replies, events] =
      await Promise.all([
        select(TABLES.sources),
        select(TABLES.roles),
        select(TABLES.facts),
        select(TABLES.skills),
        select(TABLES.skillEvidence),
        select(TABLES.postings),
        select(TABLES.applications),
        select(TABLES.requirementSets),
        select(TABLES.mappings),
        select(TABLES.packets),
        select(TABLES.approvals),
        select(TABLES.replies),
        select(TABLES.events),
      ]);
    cache = {
      profile: {
        sources: sources.map(sourceFromRow),
        roles: roles.map(roleFromRow),
        facts: facts.map(factFromRow),
        skills: skills.map(skillFromRow),
        skillEvidence: links.map(skillEvidenceFromRow),
      },
      postings: postings.map(postingFromRow),
      requirementSets: sets.map(requirementSetFromRow),
      mappings: mappings.map(mappingFromRow),
      applications: applications.map(applicationFromRow),
      packets: packets.map(packetFromRow),
      approvals: approvals.map(approvalFromRow),
      replies: replies.map(replyFromRow),
      events: events.map(eventFromRow),
    };
    return cache;
  }

  async function workspace(): Promise<Workspace> {
    return cache ?? load();
  }

  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    return check(client.rpc(name, args));
  }

  return {
    mode: "remote",
    load,

    async addSource(title, body) {
      const clean = cleanSource(title, body);
      await check(client.from(TABLES.sources).insert({ document_id: newId(), title: clean.title, body: clean.body }));
    },

    async saveRole(input: NewRole) {
      const clean = cleanRole(input);
      await check(
        client.from(TABLES.roles).insert({
          role_id: clean.roleId ?? newId(),
          employer: clean.employer,
          title: clean.title,
          start_month: clean.start,
          end_month: clean.end,
          is_current: clean.current,
          as_of: clean.asOf,
        }),
      );
    },

    async approveRole(roleId, versionId) {
      await rpc("approve_role_version", { p_role_id: roleId, p_version_id: versionId });
    },

    async withdrawRole(roleId) {
      await rpc("withdraw_role", { p_role_id: roleId });
    },

    async saveFact(input: NewFact) {
      const clean = cleanFact(input);
      const ws = await workspace();
      let origin: Record<string, unknown>;
      let documentVersionId: string | null = null;
      if (clean.origin.type === "source_span") {
        const { documentId, documentVersionId: versionId, start, end } = clean.origin;
        const doc = ws.profile.sources.find((item) => item.documentId === documentId && item.versionId === versionId);
        if (!doc) throw new RepoError("invalid_input", "Source version not found.");
        const quote = doc.body.slice(start, end);
        if (normalizeWhitespace(quote) !== clean.text) {
          throw new RepoError("invalid_input", "A source-backed statement must be the selected source text.");
        }
        origin = { type: "source_span", documentId, documentVersionId: versionId, documentSha256: doc.sha256, start, end, quote };
        documentVersionId = versionId;
        const problem = checkOrigin(ws.profile, origin as never);
        if (problem) throw new RepoError("invalid_input", problem);
      } else {
        origin = { type: "user_attestation", statement: clean.origin.statement, attestedAt: new Date().toISOString() };
      }
      await check(
        client.from(TABLES.facts).insert({
          fact_id: clean.factId ?? newId(),
          kind: clean.kind,
          body: clean.text,
          role_id: clean.roleRef?.roleId ?? null,
          role_version_id: clean.roleRef?.roleVersionId ?? null,
          project_label: clean.projectLabel,
          origin,
          origin_document_version_id: documentVersionId,
        }),
      );
    },

    async approveFact(factId, versionId) {
      await rpc("approve_fact_version", { p_fact_id: factId, p_version_id: versionId });
    },

    async withdrawFact(factId) {
      await rpc("withdraw_fact", { p_fact_id: factId });
    },

    async saveSkill(skillId, canonical, aliases) {
      const name = normalizeWhitespace(canonical);
      const clean = aliases.map((alias) => ({ alias: normalizeWhitespace(alias.alias), approved: Boolean(alias.approved) })).filter((alias) => alias.alias);
      if (skillId) {
        await check(client.from(TABLES.skills).update({ canonical: name, aliases: clean }).eq("skill_id", skillId));
      } else {
        await check(client.from(TABLES.skills).insert({ skill_id: newId(), canonical: name, aliases: clean }));
      }
    },

    async linkSkill(skillId, fact, usage: UsageInterval[], attestedMonths) {
      // Same rule as the demo: only a current approved statement can be linked.
      const ws = await load();
      if (!isCurrentFact(ws.profile, fact)) throw new RepoError("invalid_input", "Only current approved statements can be linked.");
      await check(
        client
          .from(TABLES.skillEvidence)
          .upsert(
            { skill_id: skillId, fact_id: fact.factId, fact_version_id: fact.versionId, usage, attested_months: attestedMonths },
            { onConflict: "owner_id,skill_id,fact_id" },
          ),
      );
    },

    async unlinkSkill(skillId, factId, factVersionId) {
      await check(client.from(TABLES.skillEvidence).delete().match({ skill_id: skillId, fact_id: factId, fact_version_id: factVersionId }));
    },

    async applyRepair(repair: RepairAction) {
      if (repair.type === "relink_to_current") {
        const ws = await load();
        if (!isCurrentFact(ws.profile, { factId: repair.factId, versionId: repair.toVersionId })) {
          throw new RepoError("stale", "That statement is no longer current. Reload.");
        }
        await check(
          client
            .from(TABLES.skillEvidence)
            .update({ fact_version_id: repair.toVersionId })
            .match({ skill_id: repair.skillId, fact_id: repair.factId, fact_version_id: repair.fromVersionId }),
        );
      } else if (repair.type === "remove_link") {
        await check(
          client.from(TABLES.skillEvidence).delete().match({ skill_id: repair.skillId, fact_id: repair.factId, fact_version_id: repair.factVersionId }),
        );
      } else if (repair.type === "remove_alias") {
        const ws = await workspace();
        const skill = ws.profile.skills.find((item) => item.skillId === repair.skillId);
        if (!skill) throw new RepoError("invalid_input", "Skill not found.");
        await check(
          client.from(TABLES.skills).update({ aliases: skill.aliases.filter((alias) => alias.alias !== repair.alias) }).eq("skill_id", repair.skillId),
        );
      } else {
        throw new RepoError("invalid_input", "Open the editor to repair this item.");
      }
    },

    async createPosting(input: NewPosting) {
      const clean = cleanPosting(input);
      const ws = await workspace();
      const postingId = newId();
      const versionId = newId();
      const applicationId = newId();
      const requirements: RequirementVersion[] = extractRequirements(clean.body).map((item, ordinal) => ({
        requirementId: newId(),
        versionId: newId(),
        postingVersionId: versionId,
        ordinal,
        quote: item.quote,
        clause: item.clause,
        priority: item.priority,
        flags: item.flags,
        reviewed: false,
        removed: false,
      }));
      await rpc("create_posting", {
        p_posting_id: postingId,
        p_version_id: versionId,
        p_application_id: applicationId,
        p_organisation: clean.organisation,
        p_title: clean.title,
        p_body: clean.body,
        p_url: clean.url,
        p_requirements: requirements,
        p_evidence: proposeEvidence(requirements, ws.profile),
      });
      return { postingId, applicationId };
    },

    async saveRequirements(postingVersionId, expectedRevision, edits: RequirementEdit[]) {
      const ws = await load();
      const set = latestRequirementSet(ws, postingVersionId);
      const mapping = latestMapping(ws, postingVersionId);
      if (!set || !mapping) throw new RepoError("invalid_input", "Posting not found.");
      if (set.revision !== expectedRevision) throw new RepoError("stale", "Requirements changed elsewhere. Reload and review again.");
      const posting = ws.postings.find((item) => item.versionId === postingVersionId);
      if (!posting) throw new RepoError("invalid_input", "Posting not found.");
      const requirements = nextRequirements(set, postingVersionId, cleanRequirementEdits(edits), newId, posting.body);
      await rpc("save_requirements", {
        p_posting_version_id: postingVersionId,
        p_expected_revision: expectedRevision,
        p_requirements: requirements,
        p_evidence: proposeEvidence(requirements, ws.profile, mapping.evidence),
      });
    },

    async confirmEvidence(postingVersionId, expectedMappingRevision, requirementId, decision) {
      const ws = await load();
      const set = latestRequirementSet(ws, postingVersionId);
      const mapping = latestMapping(ws, postingVersionId);
      if (!set || !mapping) throw new RepoError("invalid_input", "Posting not found.");
      if (mapping.revision !== expectedMappingRevision) throw new RepoError("stale", "Evidence changed elsewhere. Reload and confirm again.");
      const requirement = set.requirements.find((item) => item.requirementId === requirementId);
      if (!requirement) throw new RepoError("invalid_input", "Unknown requirement.");
      // Start from the live view so unrelated confirmations citing no-longer-current statements are dropped
      // instead of making the server reject the whole mapping.
      const base = proposeEvidence(set.requirements, ws.profile, mapping.evidence);
      const evidence = confirmInEvidence(base, requirement, cleanDecision(decision), new Date().toISOString());
      await rpc("save_mapping", { p_posting_version_id: postingVersionId, p_expected_revision: expectedMappingRevision, p_evidence: evidence });
    },

    async refreshProposals(postingVersionId) {
      const ws = await load();
      const set = latestRequirementSet(ws, postingVersionId);
      const mapping = latestMapping(ws, postingVersionId);
      if (!set || !mapping) throw new RepoError("invalid_input", "Posting not found.");
      const evidence = proposeEvidence(set.requirements, ws.profile, mapping.evidence);
      if (digest(evidence) === digest(mapping.evidence)) return;
      await rpc("save_mapping", { p_posting_version_id: postingVersionId, p_expected_revision: mapping.revision, p_evidence: evidence });
    },

    async savePacketRevision(applicationId, packetId, expectedRevision, lines: PacketLine[]) {
      const id = packetId ?? newId();
      const clean = cleanLines(lines);
      const revision = (await rpc("save_packet_revision", {
        p_application_id: applicationId,
        p_packet_id: id,
        p_expected_revision: expectedRevision,
        p_lines: clean,
      })) as number;
      const ws = await load();
      const saved = ws.packets.find((item) => item.packetId === id && item.revision === revision);
      if (!saved) throw new RepoError("unavailable", "Saved revision could not be read back.");
      return saved;
    },

    async approvePacket(packetId, revision, expectedRenderedSha256, requestId): Promise<ApproveResult> {
      const { data, error } = await client.functions.invoke("draft-approve", {
        body: { packet_id: packetId, revision, expected_rendered_sha256: expectedRenderedSha256, request_id: requestId, wording_attested: false },
      });
      if (error) {
        // The function returns { error: { code, message } } with a non-2xx status; supabase-js wraps it.
        type ErrorPayload = { error?: { code?: string; message?: string } };
        let payload: ErrorPayload | null = null;
        try {
          payload = ((await (error as { context?: { json?: () => Promise<unknown> } }).context?.json?.()) ?? null) as ErrorPayload | null;
        } catch {
          payload = null;
        }
        const code = (payload?.error?.code ?? "unavailable") as RepoErrorCode;
        throw new RepoError(code, payload?.error?.message ?? "Approval service unavailable.");
      }
      const body = data as {
        packet: { lines: RenderedLine[]; approval: ApproveResult["approval"] };
        export: { plain_text: string; markdown: string };
      };
      return {
        approval: { ...body.packet.approval, source: "server" },
        lines: body.packet.lines,
        export: { plainText: body.export.plain_text, markdown: body.export.markdown },
        receipt: "server",
      };
    },

    async addReply(applicationId, body) {
      const ws = await workspace();
      const app = ws.applications.find((item) => item.applicationId === applicationId);
      const posting = app ? latestPostingVersion(ws, app.postingId) : undefined;
      const clean = cleanReplyBody(body);
      const reply = {
        replyId: newId(),
        applicationId,
        body: clean,
        prediction: classifyReply(clean, posting ? { organisation: posting.organisation, title: posting.title } : null),
        chosenLabel: null,
        confirmedAt: null,
        createdAt: new Date().toISOString(),
      };
      await rpc("add_reply", { p_reply_id: reply.replyId, p_application_id: applicationId, p_body: clean, p_prediction: reply.prediction });
      return reply;
    },

    async applyStageChange(request: StageChangeRequest): Promise<StageChangeResult> {
      const result = (await rpc("apply_stage_change", {
        p_application_id: request.applicationId,
        p_expected_revision: request.expectedRevision,
        p_to_stage: request.toStage,
        p_reply_id: request.replyId,
        p_chosen_label: request.chosenLabel,
        p_request_id: request.requestId,
      })) as { ok: boolean; code?: string; message?: string };
      if (!result.ok) {
        return { ok: false, code: (result.code ?? "invalid_input") as "conflict", message: result.message ?? "Stage change refused." };
      }
      const ws = await load();
      const application = ws.applications.find((item) => item.applicationId === request.applicationId);
      const event = ws.events.find((item) => item.applicationId === request.applicationId && item.requestId === request.requestId);
      if (!application || !event) throw new RepoError("unavailable", "Stage change saved but could not be read back. Reload.");
      return { ok: true, application, event, reply: ws.replies.find((item) => item.replyId === request.replyId) ?? null };
    },

    async saveNotes(applicationId, notes) {
      await rpc("save_notes", { p_application_id: applicationId, p_notes: notes });
    },
  };

  void userId; // identity comes from the JWT on every request; the id is kept only for callers' logging
}
