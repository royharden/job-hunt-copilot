import {
  shouldReplaceDraftLink,
  statusAfterApproval,
  statusAfterConfirmedReply,
} from "../../supabase/functions/_shared/provenance/board.ts";
import { SAMPLE_FACTS } from "../../supabase/functions/_shared/provenance/fixtures.ts";
import { isApprovable } from "../../supabase/functions/_shared/provenance/gate.ts";
import { LIMITS } from "../../supabase/functions/_shared/provenance/limits.ts";
import type { RequirementMatch } from "../../supabase/functions/_shared/provenance/types.ts";
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
import { cleanFact, cleanPosting, cleanReply, requireBoardStatus, requireReplyLabel } from "./validate.ts";

const STORAGE_KEY = "job-hunt-copilot-demo-v1";
const SAMPLE_IDS = new Set(SAMPLE_FACTS.map((fact) => fact.id));

interface DemoState {
  facts: FactRecord[];
  postings: PostingRecord[];
  matches: RequirementMatch[];
  drafts: DraftRecord[];
  applications: ApplicationRecord[];
  replies: ReplyRecord[];
}

function emptyState(): DemoState {
  return { facts: [], postings: [], matches: [], drafts: [], applications: [], replies: [] };
}

function browserStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function createDemoStore(): HuntRepository {
  const storage = browserStorage();
  let state = load();

  function load(): DemoState {
    if (!storage) return emptyState();
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw) as Partial<DemoState>;
      return {
        facts: asArray(parsed.facts),
        postings: asArray(parsed.postings),
        matches: asArray(parsed.matches),
        drafts: asArray(parsed.drafts),
        applications: asArray(parsed.applications),
        replies: asArray(parsed.replies),
      };
    } catch {
      return emptyState();
    }
  }

  function persist(): void {
    if (!storage) return;
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function now(): string {
    return new Date().toISOString();
  }

  function applicationForPosting(postingId: string): ApplicationRecord {
    const found = state.applications.find((item) => item.postingId === postingId);
    if (!found) throw new Error("This posting has no application card.");
    return found;
  }

  return {
    mode: "demo",
    async listFacts() {
      return state.facts.map((fact) => ({ ...fact }));
    },
    async createFact(input: NewFact) {
      if (state.facts.length >= LIMITS.factsPerUser) throw new Error("The fact limit is 200.");
      const cleaned = cleanFact(input);
      const fact: FactRecord = { id: crypto.randomUUID(), ...cleaned, createdAt: now() };
      state = { ...state, facts: [...state.facts, fact] };
      persist();
      return { ...fact };
    },
    async deleteFact(id: string) {
      state = { ...state, facts: state.facts.filter((fact) => fact.id !== id) };
      persist();
    },
    async loadSampleFacts() {
      const seen = new Set(state.facts.map((fact) => fact.id));
      const additions: FactRecord[] = [];
      for (const fact of SAMPLE_FACTS) {
        if (seen.has(fact.id)) continue;
        additions.push({ ...fact, createdAt: now() });
      }
      if (state.facts.length + additions.length > LIMITS.factsPerUser) {
        throw new Error("The fact limit is 200.");
      }
      state = { ...state, facts: [...state.facts, ...additions] };
      persist();
    },
    async removeSampleFacts() {
      state = { ...state, facts: state.facts.filter((fact) => !SAMPLE_IDS.has(fact.id)) };
      persist();
    },
    async listPostings() {
      return [...state.postings].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    },
    async createPosting(input: NewPosting) {
      const cleaned = cleanPosting(input);
      const createdAt = now();
      const posting: PostingRecord = { id: crypto.randomUUID(), ...cleaned, createdAt };
      const application: ApplicationRecord = {
        id: crypto.randomUUID(),
        postingId: posting.id,
        draftId: null,
        boardStatus: "draft",
        updatedAt: createdAt,
      };
      state = {
        ...state,
        postings: [...state.postings, posting],
        applications: [...state.applications, application],
      };
      persist();
      return { ...posting };
    },
    async listMatches(postingId: string) {
      return state.matches
        .filter((match) => match.postingId === postingId)
        .sort((left, right) => left.ordinal - right.ordinal)
        .map((match) => ({ ...match, supportFactIds: [...match.supportFactIds] }));
    },
    async replaceMatches(postingId: string, matches: RequirementMatch[]) {
      state = {
        ...state,
        matches: [
          ...state.matches.filter((match) => match.postingId !== postingId),
          ...matches.map((match) => ({ ...match, postingId, supportFactIds: [...match.supportFactIds] })),
        ],
      };
      persist();
    },
    async listDrafts(postingId: string) {
      return state.drafts
        .filter((draft) => draft.postingId === postingId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((draft) => ({ ...draft, bullets: draft.bullets.map((bullet) => ({ ...bullet })), cover: [...draft.cover] }));
    },
    async saveDraft(input: NewDraft) {
      applicationForPosting(input.postingId);
      const draft: DraftRecord = {
        id: crypto.randomUUID(),
        postingId: input.postingId,
        source: input.source,
        model: input.model,
        bullets: input.bullets,
        cover: input.cover,
        gate: input.gate,
        approvable: isApprovable(input.gate),
        approvedAt: null,
        createdAt: now(),
      };
      const application = applicationForPosting(input.postingId);
      const linked = state.drafts.find((item) => item.id === application.draftId);
      const applications = shouldReplaceDraftLink(Boolean(linked?.approvedAt))
        ? state.applications.map((item) =>
            item.id === application.id ? { ...item, draftId: draft.id, updatedAt: now() } : item,
          )
        : state.applications;
      state = { ...state, drafts: [...state.drafts, draft], applications };
      persist();
      return { ...draft };
    },
    async approveDraft(id: string) {
      const draft = state.drafts.find((item) => item.id === id);
      if (!draft) throw new Error("Draft not found.");
      if (!isApprovable(draft.gate)) throw new Error("This draft still has blocked or reverted lines.");
      if (!draft.approvedAt) {
        draft.approvedAt = now();
        draft.approvable = true;
      }
      state = {
        ...state,
        drafts: state.drafts.map((item) => (item.id === id ? { ...draft } : item)),
        applications: state.applications.map((item) =>
          item.postingId === draft.postingId
            ? {
                ...item,
                draftId: draft.id,
                boardStatus: statusAfterApproval(item.boardStatus),
                updatedAt: now(),
              }
            : item,
        ),
      };
      persist();
    },
    async listApplications() {
      return state.applications.map((item) => ({ ...item }));
    },
    async setBoardStatus(id: string, status: ApplicationRecord["boardStatus"]) {
      const boardStatus = requireBoardStatus(status);
      const found = state.applications.find((item) => item.id === id);
      if (!found) throw new Error("Application not found.");
      state = {
        ...state,
        applications: state.applications.map((item) =>
          item.id === id ? { ...item, boardStatus, updatedAt: now() } : item,
        ),
      };
      persist();
    },
    async listReplies(applicationId: string) {
      return state.replies
        .filter((reply) => reply.applicationId === applicationId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((reply) => ({ ...reply }));
    },
    async saveReply(input: NewReply) {
      const cleaned = cleanReply(input);
      if (!state.applications.some((item) => item.id === cleaned.applicationId)) {
        throw new Error("Application not found.");
      }
      const reply: ReplyRecord = { id: crypto.randomUUID(), ...cleaned, confirmedLabel: null, createdAt: now() };
      state = { ...state, replies: [...state.replies, reply] };
      persist();
      return { ...reply };
    },
    async confirmReply(id: string, label: ReplyRecord["confirmedLabel"]) {
      if (!label) throw new Error("Choose a status to confirm.");
      const confirmed = requireReplyLabel(label);
      const reply = state.replies.find((item) => item.id === id);
      if (!reply) throw new Error("Reply not found.");
      if (reply.confirmedLabel) throw new Error("This reply was already confirmed.");
      const application = state.applications.find((item) => item.id === reply.applicationId);
      if (!application) throw new Error("Application not found.");
      state = {
        ...state,
        replies: state.replies.map((item) => (item.id === id ? { ...item, confirmedLabel: confirmed } : item)),
        applications: state.applications.map((item) =>
          item.id === application.id
            ? { ...item, boardStatus: statusAfterConfirmedReply(item.boardStatus, confirmed), updatedAt: now() }
            : item,
        ),
      };
      persist();
    },
    async requestModelDraft(): Promise<ModelDraftResult> {
      return {
        ok: false,
        message:
          "Model drafts run only for a signed-in project. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, sign in, and set the server secret XAI_API_KEY. This demo does not call the model.",
      };
    },
  };
}
