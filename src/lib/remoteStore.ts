import type { SupabaseClient } from "@supabase/supabase-js";
import {
  shouldReplaceDraftLink,
  statusAfterApproval,
  statusAfterConfirmedReply,
} from "../../supabase/functions/_shared/provenance/board.ts";
import { SAMPLE_FACTS } from "../../supabase/functions/_shared/provenance/fixtures.ts";
import { isApprovable } from "../../supabase/functions/_shared/provenance/gate.ts";
import { LIMITS } from "../../supabase/functions/_shared/provenance/limits.ts";
import type {
  DraftSource,
  GateReport,
  RequirementMatch,
} from "../../supabase/functions/_shared/provenance/types.ts";
import type {
  ApplicationRecord,
  DraftRecord,
  FactRecord,
  HuntRepository,
  ModelDraftResult,
  NewDraft,
  NewFact,
  NewPosting,
  NewReply,
  PostingRecord,
  ReplyRecord,
} from "./repository.ts";
import {
  cleanFact,
  cleanPosting,
  cleanReply,
  requireBoardStatus,
  requireFactKind,
  requirePostingKind,
  requireReplyLabel,
} from "./validate.ts";

interface FactRow {
  id: string;
  kind: string;
  surface: string;
  body: string;
  created_at: string;
}

interface PostingRow {
  id: string;
  kind: string;
  title: string;
  organization: string;
  body: string;
  created_at: string;
}

interface MatchRow {
  id: string;
  posting_id: string;
  ordinal: number;
  body: string;
  label: string;
  support_fact_ids: string[] | null;
  reason: string;
}

interface DraftRow {
  id: string;
  posting_id: string;
  source: string;
  model: string | null;
  bullets: DraftRecord["bullets"];
  cover: DraftRecord["cover"];
  gate_report: unknown;
  approvable: boolean;
  approved_at: string | null;
  created_at: string;
}

interface ApplicationRow {
  id: string;
  posting_id: string;
  draft_id: string | null;
  board_status: string;
  updated_at: string;
}

interface ReplyRow {
  id: string;
  application_id: string;
  body: string;
  predicted_label: string;
  confidence: number | string;
  needs_review: boolean;
  confirmed_label: string | null;
  created_at: string;
}

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function asGate(value: unknown): GateReport {
  if (!value || typeof value !== "object") {
    return { bullets: [], cover: [], passed: 0, reverted: 0, dropped: 0 };
  }
  const record = value as Partial<GateReport>;
  return {
    bullets: Array.isArray(record.bullets) ? record.bullets : [],
    cover: Array.isArray(record.cover) ? record.cover : [],
    passed: typeof record.passed === "number" ? record.passed : 0,
    reverted: typeof record.reverted === "number" ? record.reverted : 0,
    dropped: typeof record.dropped === "number" ? record.dropped : 0,
  };
}

function requireSource(value: string): DraftSource {
  if (value === "local_restatement" || value === "model") return value;
  throw new Error(`Unexpected draft source: ${value}`);
}

function mapFact(row: FactRow): FactRecord {
  return {
    id: row.id,
    kind: requireFactKind(row.kind),
    surface: row.surface,
    text: row.body,
    createdAt: row.created_at,
  };
}

function mapPosting(row: PostingRow): PostingRecord {
  return {
    id: row.id,
    kind: requirePostingKind(row.kind),
    title: row.title,
    organization: row.organization,
    text: row.body,
    createdAt: row.created_at,
  };
}

function mapMatch(row: MatchRow): RequirementMatch {
  const label = row.label;
  if (label !== "exact" && label !== "lexical" && label !== "gap") {
    throw new Error(`Unexpected match label: ${row.label}`);
  }
  return {
    id: row.id,
    postingId: row.posting_id,
    ordinal: row.ordinal,
    text: row.body,
    label,
    supportFactIds: row.support_fact_ids ?? [],
    reason: row.reason,
  };
}

function mapDraft(row: DraftRow): DraftRecord {
  return {
    id: row.id,
    postingId: row.posting_id,
    source: requireSource(row.source),
    model: row.model,
    bullets: Array.isArray(row.bullets) ? row.bullets : [],
    cover: Array.isArray(row.cover) ? row.cover : [],
    gate: asGate(row.gate_report),
    approvable: row.approvable,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
  };
}

function mapApplication(row: ApplicationRow): ApplicationRecord {
  return {
    id: row.id,
    postingId: row.posting_id,
    draftId: row.draft_id,
    boardStatus: requireBoardStatus(row.board_status),
    updatedAt: row.updated_at,
  };
}

function mapReply(row: ReplyRow): ReplyRecord {
  return {
    id: row.id,
    applicationId: row.application_id,
    text: row.body,
    predictedLabel: requireReplyLabel(row.predicted_label),
    confidence: Number(row.confidence),
    needsReview: row.needs_review,
    confirmedLabel: row.confirmed_label ? requireReplyLabel(row.confirmed_label) : null,
    createdAt: row.created_at,
  };
}

async function readInvokeError(error: { message: string; context?: unknown }): Promise<string> {
  const context = error.context;
  if (context instanceof Response) {
    try {
      const body = (await context.json()) as { message?: unknown };
      if (typeof body.message === "string" && body.message.trim().length > 0) return body.message;
    } catch {
      // The function body was not JSON.
    }
  }
  return error.message || "The model draft failed.";
}

export function createRemoteStore(client: SupabaseClient, userId: string): HuntRepository {
  return {
    mode: "remote",
    async listFacts() {
      const result = await client.from("facts").select("id, kind, surface, body, created_at").order("created_at");
      fail(result.error);
      return (result.data as FactRow[]).map(mapFact);
    },
    async createFact(input: NewFact) {
      const count = await client.from("facts").select("id", { count: "exact", head: true });
      fail(count.error);
      if ((count.count ?? 0) >= LIMITS.factsPerUser) throw new Error("The fact limit is 200.");
      const cleaned = cleanFact(input);
      const result = await client
        .from("facts")
        .insert({ user_id: userId, kind: cleaned.kind, surface: cleaned.surface, body: cleaned.text })
        .select("id, kind, surface, body, created_at")
        .single();
      fail(result.error);
      return mapFact(result.data as FactRow);
    },
    async deleteFact(id: string) {
      const result = await client.from("facts").delete().eq("id", id);
      fail(result.error);
    },
    async loadSampleFacts() {
      const existing = await client.from("facts").select("id");
      fail(existing.error);
      const seen = new Set((existing.data as Array<{ id: string }>).map((row) => row.id));
      const rows = SAMPLE_FACTS.filter((fact) => !seen.has(fact.id)).map((fact) => ({
        id: fact.id,
        user_id: userId,
        kind: fact.kind,
        surface: fact.surface,
        body: fact.text,
      }));
      if (seen.size + rows.length > LIMITS.factsPerUser) throw new Error("The fact limit is 200.");
      if (rows.length === 0) return;
      fail((await client.from("facts").insert(rows)).error);
    },
    async removeSampleFacts() {
      const result = await client.from("facts").delete().in("id", SAMPLE_FACTS.map((fact) => fact.id));
      fail(result.error);
    },
    async listPostings() {
      const result = await client
        .from("postings")
        .select("id, kind, title, organization, body, created_at")
        .order("created_at", { ascending: false });
      fail(result.error);
      return (result.data as PostingRow[]).map(mapPosting);
    },
    async createPosting(input: NewPosting) {
      const cleaned = cleanPosting(input);
      const inserted = await client
        .from("postings")
        .insert({
          user_id: userId,
          kind: cleaned.kind,
          title: cleaned.title,
          organization: cleaned.organization,
          body: cleaned.text,
        })
        .select("id, kind, title, organization, body, created_at")
        .single();
      fail(inserted.error);
      const posting = mapPosting(inserted.data as PostingRow);
      const application = await client.from("applications").insert({
        user_id: userId,
        posting_id: posting.id,
        board_status: "draft",
      });
      if (application.error) {
        await client.from("postings").delete().eq("id", posting.id);
        throw new Error(application.error.message);
      }
      return posting;
    },
    async listMatches(postingId: string) {
      const result = await client
        .from("requirement_matches")
        .select("id, posting_id, ordinal, body, label, support_fact_ids, reason")
        .eq("posting_id", postingId)
        .order("ordinal");
      fail(result.error);
      return (result.data as MatchRow[]).map(mapMatch);
    },
    async replaceMatches(postingId: string, matches: RequirementMatch[]) {
      fail((await client.from("requirement_matches").delete().eq("posting_id", postingId)).error);
      if (matches.length === 0) return;
      const rows = matches.map((match) => ({
        user_id: userId,
        posting_id: postingId,
        ordinal: match.ordinal,
        body: match.text,
        label: match.label,
        support_fact_ids: match.supportFactIds,
        reason: match.reason.slice(0, 500),
      }));
      fail((await client.from("requirement_matches").insert(rows)).error);
    },
    async listDrafts(postingId: string) {
      const result = await client
        .from("drafts")
        .select("id, posting_id, source, model, bullets, cover, gate_report, approvable, approved_at, created_at")
        .eq("posting_id", postingId)
        .order("created_at", { ascending: false });
      fail(result.error);
      return (result.data as DraftRow[]).map(mapDraft);
    },
    async saveDraft(input: NewDraft) {
      const approvable = isApprovable(input.gate);
      const inserted = await client
        .from("drafts")
        .insert({
          user_id: userId,
          posting_id: input.postingId,
          source: input.source,
          model: input.model,
          bullets: input.bullets,
          cover: input.cover,
          gate_report: input.gate,
          approvable,
        })
        .select("id, posting_id, source, model, bullets, cover, gate_report, approvable, approved_at, created_at")
        .single();
      fail(inserted.error);
      const draft = mapDraft(inserted.data as DraftRow);
      const application = await client
        .from("applications")
        .select("id, draft_id")
        .eq("posting_id", input.postingId)
        .maybeSingle();
      fail(application.error);
      const app = application.data as { id: string; draft_id: string | null } | null;
      if (!app) throw new Error("This posting has no application card.");
      let linkedApproved = false;
      if (app.draft_id) {
        const linked = await client.from("drafts").select("approved_at").eq("id", app.draft_id).maybeSingle();
        fail(linked.error);
        linkedApproved = Boolean((linked.data as { approved_at: string | null } | null)?.approved_at);
      }
      if (shouldReplaceDraftLink(linkedApproved)) {
        fail(
          (
            await client
              .from("applications")
              .update({ draft_id: draft.id, updated_at: new Date().toISOString() })
              .eq("id", app.id)
          ).error,
        );
      }
      return draft;
    },
    async approveDraft(id: string) {
      const loaded = await client
        .from("drafts")
        .select("id, posting_id, source, model, bullets, cover, gate_report, approvable, approved_at, created_at")
        .eq("id", id)
        .maybeSingle();
      fail(loaded.error);
      if (!loaded.data) throw new Error("Draft not found.");
      const draft = mapDraft(loaded.data as DraftRow);
      if (!draft.approvedAt) {
        if (!isApprovable(draft.gate)) throw new Error("This draft still has blocked or reverted lines.");
        fail(
          (
            await client.from("drafts").update({ approved_at: new Date().toISOString(), approvable: true }).eq("id", id)
          ).error,
        );
      }
      const application = await client
        .from("applications")
        .select("id, posting_id, draft_id, board_status, updated_at")
        .eq("posting_id", draft.postingId)
        .maybeSingle();
      fail(application.error);
      if (!application.data) throw new Error("This posting has no application card.");
      const current = mapApplication(application.data as ApplicationRow);
      fail(
        (
          await client
            .from("applications")
            .update({
              draft_id: draft.id,
              board_status: statusAfterApproval(current.boardStatus),
              updated_at: new Date().toISOString(),
            })
            .eq("id", current.id)
        ).error,
      );
    },
    async listApplications() {
      const result = await client
        .from("applications")
        .select("id, posting_id, draft_id, board_status, updated_at")
        .order("updated_at", { ascending: false });
      fail(result.error);
      return (result.data as ApplicationRow[]).map(mapApplication);
    },
    async setBoardStatus(id: string, status: ApplicationRecord["boardStatus"]) {
      const boardStatus = requireBoardStatus(status);
      fail(
        (
          await client
            .from("applications")
            .update({ board_status: boardStatus, updated_at: new Date().toISOString() })
            .eq("id", id)
        ).error,
      );
    },
    async listReplies(applicationId: string) {
      const result = await client
        .from("replies")
        .select("id, application_id, body, predicted_label, confidence, needs_review, confirmed_label, created_at")
        .eq("application_id", applicationId)
        .order("created_at", { ascending: false });
      fail(result.error);
      return (result.data as ReplyRow[]).map(mapReply);
    },
    async saveReply(input: NewReply) {
      const cleaned = cleanReply(input);
      const result = await client
        .from("replies")
        .insert({
          user_id: userId,
          application_id: cleaned.applicationId,
          body: cleaned.text,
          predicted_label: cleaned.predictedLabel,
          confidence: cleaned.confidence,
          needs_review: cleaned.needsReview,
        })
        .select("id, application_id, body, predicted_label, confidence, needs_review, confirmed_label, created_at")
        .single();
      fail(result.error);
      return mapReply(result.data as ReplyRow);
    },
    async confirmReply(id: string, label: ReplyRecord["confirmedLabel"]) {
      if (!label) throw new Error("Choose a status to confirm.");
      const confirmed = requireReplyLabel(label);
      const updated = await client
        .from("replies")
        .update({ confirmed_label: confirmed })
        .eq("id", id)
        .is("confirmed_label", null)
        .select("id, application_id")
        .maybeSingle();
      fail(updated.error);
      const reply = updated.data as { id: string; application_id: string } | null;
      if (!reply) throw new Error("This reply was already confirmed, or it was not found.");
      const application = await client
        .from("applications")
        .select("id, posting_id, draft_id, board_status, updated_at")
        .eq("id", reply.application_id)
        .maybeSingle();
      fail(application.error);
      if (!application.data) throw new Error("Application not found.");
      const current = mapApplication(application.data as ApplicationRow);
      fail(
        (
          await client
            .from("applications")
            .update({
              board_status: statusAfterConfirmedReply(current.boardStatus, confirmed),
              updated_at: new Date().toISOString(),
            })
            .eq("id", current.id)
        ).error,
      );
    },
    async requestModelDraft(postingId: string): Promise<ModelDraftResult> {
      const invoked = await client.functions.invoke("draft-materials", { body: { posting_id: postingId } });
      if (invoked.error) return { ok: false, message: await readInvokeError(invoked.error) };
      const body = invoked.data as { message?: string; draft?: DraftRow } | null;
      if (!body?.draft) return { ok: false, message: body?.message ?? "The model draft was not saved." };
      try {
        return { ok: true, draft: mapDraft(body.draft) };
      } catch (error) {
        const message = error instanceof Error ? error.message : "The model draft could not be read.";
        return { ok: false, message };
      }
    },
  };
}
