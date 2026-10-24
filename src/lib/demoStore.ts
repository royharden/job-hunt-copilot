import { bindingSha256, computeBinding } from "../../supabase/functions/_shared/provenance/binding.ts";
import {
  applyStageChange as applyStageModel,
  stageAfterApproval,
  stageRequestFingerprint,
  type StageChangeRecord,
  type StageChangeRequest,
  type StageChangeResult,
} from "../../supabase/functions/_shared/provenance/board.ts";
import { classifyReply } from "../../supabase/functions/_shared/provenance/classify.ts";
import { extractRequirements } from "../../supabase/functions/_shared/provenance/extract.ts";
import { sampleProfile } from "../../supabase/functions/_shared/provenance/fixtures.ts";
import { exportPacket, gatePacket } from "../../supabase/functions/_shared/provenance/gate.ts";
import { digest, sha256Hex } from "../../supabase/functions/_shared/provenance/hash.ts";
import { blockingProblems, validateProfile, type RepairAction } from "../../supabase/functions/_shared/provenance/health.ts";
import { LIMITS } from "../../supabase/functions/_shared/provenance/limits.ts";
import { proposeEvidence } from "../../supabase/functions/_shared/provenance/match.ts";
import { normalizeWhitespace } from "../../supabase/functions/_shared/provenance/normalize.ts";
import type {
  Application,
  FactRef,
  FactVersion,
  PacketLine,
  PacketRevision,
  RequirementVersion,
  RoleVersion,
  Stage,
  UsageInterval,
} from "../../supabase/functions/_shared/provenance/types.ts";
import { checkOrigin, currentFactVersion, currentRoleVersion, isCurrentFact } from "../../supabase/functions/_shared/provenance/versions.ts";
import {
  RepoError,
  type ApproveResult,
  type EvidenceDecision,
  type HuntRepository,
  type NewFact,
  type NewPosting,
  type NewRole,
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
  requireStage,
} from "./validate.ts";
import { latestMapping, latestPacket, latestPostingVersion, latestRequirementSet } from "./workspace.ts";
import { confirmInEvidence, nextRequirements } from "./edits.ts";

// Explicit, isolated synthetic demo (PLAN section 8). State lives only in this browser under a versioned
// key, never writes live rows and never calls a provider. Approvals here are demo-local: computed with the
// same pure core as the server, but there is no server receipt.

export const DEMO_STORAGE_KEY = "job-hunt-copilot-demo-v2";
export const LEGACY_DEMO_KEYS = ["job-hunt-copilot-demo-v1"];
const SCHEMA = 2;

interface DemoState extends Workspace {
  schema: number;
  stageHistory: StageChangeRecord[];
}

function freshState(): DemoState {
  return {
    schema: SCHEMA,
    profile: sampleProfile(),
    postings: [],
    requirementSets: [],
    mappings: [],
    applications: [],
    packets: [],
    approvals: [],
    replies: [],
    events: [],
    stageHistory: [],
  };
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export type DemoStorageStatus = "empty" | "ok" | "incompatible" | "legacy_only" | "unavailable";

export function demoStorageStatus(): DemoStorageStatus {
  const store = storage();
  if (!store) return "unavailable";
  const raw = store.getItem(DEMO_STORAGE_KEY);
  if (raw === null) return LEGACY_DEMO_KEYS.some((key) => store.getItem(key) !== null) ? "legacy_only" : "empty";
  try {
    const parsed = JSON.parse(raw) as { schema?: number };
    return parsed.schema === SCHEMA ? "ok" : "incompatible";
  } catch {
    return "incompatible";
  }
}

// Explicit reset: removes this demo's own keys (current and legacy) and nothing else.
export function resetDemoStorage(): void {
  const store = storage();
  if (!store) return;
  store.removeItem(DEMO_STORAGE_KEY);
  for (const key of LEGACY_DEMO_KEYS) store.removeItem(key);
}

export function newId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

function invalid(message: string): never {
  throw new RepoError("invalid_input", message);
}

export function createDemoStore(): HuntRepository {
  const store = storage();
  let clock = 0;
  const now = () => {
    // Strictly increasing timestamps so version ordering never ties within one session.
    const value = Math.max(Date.now(), clock + 1);
    clock = value;
    return new Date(value).toISOString();
  };

  // Without browser storage the demo still works for this page view, from memory only.
  let memory: DemoState | null = null;

  function read(): DemoState {
    if (!store) return (memory ??= freshState());
    const raw = store.getItem(DEMO_STORAGE_KEY);
    if (raw === null) {
      const state = freshState();
      store.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
      return state;
    }
    let parsed: DemoState;
    try {
      parsed = JSON.parse(raw) as DemoState;
    } catch {
      throw new RepoError("invalid_input", "Stored demo data cannot be read. Reset the demo to continue.");
    }
    if (parsed.schema !== SCHEMA) {
      throw new RepoError("invalid_input", "Stored demo data is from an older version. Reset the demo to continue.");
    }
    return parsed;
  }

  let state = read();

  function commit(next: DemoState) {
    state = next;
    memory = next;
    if (store) store.setItem(DEMO_STORAGE_KEY, JSON.stringify(next));
  }

  // Every mutation works on a copy and commits only when it finishes, so a failed check changes nothing.
  // It re-reads storage first so another tab's committed changes are seen by revision/stale checks.
  async function mutate<T>(change: (draft: DemoState) => T): Promise<T> {
    state = read();
    const draft = JSON.parse(JSON.stringify(state)) as DemoState;
    const result = change(draft);
    commit(draft);
    return result;
  }

  function application(draft: DemoState, applicationId: string): Application {
    return draft.applications.find((item) => item.applicationId === applicationId) ?? invalid("Application not found.");
  }

  function moveStage(draft: DemoState, app: Application, toStage: Stage, requestId: string) {
    if (app.stage === toStage) return;
    const request: StageChangeRequest = {
      applicationId: app.applicationId,
      expectedRevision: app.revision,
      toStage,
      replyId: null,
      chosenLabel: null,
      requestId,
    };
    const result = applyStageModel({ application: app, replies: draft.replies, history: draft.stageHistory }, request, now(), newId);
    if (!result.ok) throw new RepoError(result.code, result.message);
    Object.assign(app, result.application);
    draft.events.push(result.event);
    draft.stageHistory.push({ requestId, fingerprint: stageRequestFingerprint(request), result });
  }

  function requireCurrentFacts(draft: DemoState, refs: FactRef[]) {
    for (const ref of refs) {
      if (!isCurrentFact(draft.profile, ref)) invalid("Only current approved sentences can be confirmed as evidence.");
    }
  }

  return {
    mode: "demo",

    async load() {
      state = read();
      return JSON.parse(JSON.stringify(state)) as Workspace;
    },

    addSource(title, body) {
      return mutate((draft) => {
        const clean = cleanSource(title, body);
        draft.profile.sources.push({
          documentId: newId(),
          versionId: newId(),
          title: clean.title,
          body: clean.body,
          sha256: sha256Hex(clean.body),
          createdAt: now(),
        });
      });
    },

    saveRole(input: NewRole) {
      return mutate((draft) => {
        const clean = cleanRole(input);
        if (draft.profile.roles.length >= LIMITS.rolesPerUser * 4) invalid("Too many role versions.");
        const role: RoleVersion = {
          roleId: clean.roleId ?? newId(),
          versionId: newId(),
          employer: clean.employer,
          title: clean.title,
          start: clean.start,
          end: clean.end,
          current: clean.current,
          asOf: clean.asOf,
          status: "draft",
          approvedAt: null,
          createdAt: now(),
        };
        draft.profile.roles.push(role);
      });
    },

    approveRole(roleId, versionId) {
      return mutate((draft) => {
        const role = draft.profile.roles.find((item) => item.roleId === roleId && item.versionId === versionId);
        if (!role || role.status !== "draft") invalid("Only a draft role version can be approved.");
        role.status = "approved";
        role.approvedAt = now();
        role.createdAt = role.approvedAt; // approval makes it the newest decision for this role
      });
    },

    withdrawRole(roleId) {
      return mutate((draft) => {
        const current = currentRoleVersion(draft.profile.roles, roleId) ?? invalid("No approved role to withdraw.");
        draft.profile.roles.push({ ...current, versionId: newId(), status: "withdrawn", createdAt: now() });
      });
    },

    saveFact(input: NewFact) {
      return mutate((draft) => {
        const clean = cleanFact(input);
        if (draft.profile.facts.length >= LIMITS.factsPerUser * 4) invalid("Too many fact versions.");
        let origin: FactVersion["origin"];
        if (clean.origin.type === "source_span") {
          const { documentId, documentVersionId, start, end } = clean.origin;
          const doc =
            draft.profile.sources.find((item) => item.documentId === documentId && item.versionId === documentVersionId) ??
            invalid("Source version not found.");
          if (end > doc.body.length) invalid("Span is outside the source text.");
          const quote = doc.body.slice(start, end);
          if (normalizeWhitespace(quote) !== clean.text) {
            invalid("A source-backed statement must be the selected source text. Use a personal statement for other wording.");
          }
          origin = { type: "source_span", documentId, documentVersionId, documentSha256: doc.sha256, start, end, quote };
        } else {
          origin = { type: "user_attestation", statement: clean.origin.statement, attestedAt: now() };
        }
        if (clean.roleRef && !draft.profile.roles.some((role) => role.roleId === clean.roleRef!.roleId && role.versionId === clean.roleRef!.roleVersionId)) {
          invalid("Role version not found.");
        }
        const problem = checkOrigin(draft.profile, origin);
        if (problem) invalid(problem);
        draft.profile.facts.push({
          factId: clean.factId ?? newId(),
          versionId: newId(),
          kind: clean.kind,
          text: clean.text,
          roleRef: clean.roleRef,
          projectLabel: clean.projectLabel,
          status: "draft",
          origin,
          approvedAt: null,
          withdrawnAt: null,
          createdAt: now(),
        });
      });
    },

    approveFact(factId, versionId) {
      return mutate((draft) => {
        const fact = draft.profile.facts.find((item) => item.factId === factId && item.versionId === versionId);
        if (!fact || fact.status !== "draft") invalid("Only a draft statement can be approved.");
        const problem = checkOrigin(draft.profile, fact.origin);
        if (problem) invalid(problem);
        fact.status = "approved";
        fact.approvedAt = now();
        fact.createdAt = fact.approvedAt;
      });
    },

    withdrawFact(factId) {
      return mutate((draft) => {
        const current = currentFactVersion(draft.profile.facts, factId) ?? invalid("No approved statement to withdraw.");
        const at = now();
        draft.profile.facts.push({ ...current, versionId: newId(), status: "withdrawn", withdrawnAt: at, createdAt: at });
      });
    },

    saveSkill(skillId, canonical, aliases) {
      return mutate((draft) => {
        const name = normalizeWhitespace(canonical);
        if (name.length < 1 || name.length > LIMITS.aliasChars) invalid("Skill name must be 1 to 60 characters.");
        if (aliases.length > LIMITS.aliasesPerSkill) invalid("Too many aliases.");
        const cleanAliases = aliases
          .map((alias) => ({ alias: normalizeWhitespace(alias.alias), approved: Boolean(alias.approved) }))
          .filter((alias) => alias.alias.length > 0 && alias.alias.length <= LIMITS.aliasChars);
        if (skillId) {
          const skill = draft.profile.skills.find((item) => item.skillId === skillId) ?? invalid("Skill not found.");
          skill.canonical = name;
          skill.aliases = cleanAliases;
        } else {
          if (draft.profile.skills.length >= LIMITS.skillsPerUser) invalid("Too many skills.");
          draft.profile.skills.push({ skillId: newId(), canonical: name, aliases: cleanAliases });
        }
      });
    },

    linkSkill(skillId, fact, usage: UsageInterval[], attestedMonths) {
      return mutate((draft) => {
        if (!draft.profile.skills.some((skill) => skill.skillId === skillId)) invalid("Skill not found.");
        requireCurrentFacts(draft, [fact]);
        if (attestedMonths !== null && (!Number.isInteger(attestedMonths) || attestedMonths < 0 || attestedMonths > 600)) {
          invalid("Attested months must be a whole number from 0 to 600.");
        }
        draft.profile.skillEvidence = draft.profile.skillEvidence.filter(
          (link) => !(link.skillId === skillId && link.factId === fact.factId),
        );
        draft.profile.skillEvidence.push({ skillId, factId: fact.factId, factVersionId: fact.versionId, usage, attestedMonths });
      });
    },

    unlinkSkill(skillId, factId, factVersionId) {
      return mutate((draft) => {
        draft.profile.skillEvidence = draft.profile.skillEvidence.filter(
          (link) => !(link.skillId === skillId && link.factId === factId && link.factVersionId === factVersionId),
        );
      });
    },

    applyRepair(repair: RepairAction) {
      return mutate((draft) => {
        if (repair.type === "relink_to_current") {
          const link =
            draft.profile.skillEvidence.find(
              (item) => item.skillId === repair.skillId && item.factId === repair.factId && item.factVersionId === repair.fromVersionId,
            ) ?? invalid("Link not found.");
          requireCurrentFacts(draft, [{ factId: repair.factId, versionId: repair.toVersionId }]);
          draft.profile.skillEvidence = draft.profile.skillEvidence.filter(
            (item) => item === link || !(item.skillId === repair.skillId && item.factId === repair.factId),
          );
          link.factVersionId = repair.toVersionId;
        } else if (repair.type === "remove_link") {
          draft.profile.skillEvidence = draft.profile.skillEvidence.filter(
            (item) => !(item.skillId === repair.skillId && item.factId === repair.factId && item.factVersionId === repair.factVersionId),
          );
        } else if (repair.type === "remove_alias") {
          const skill = draft.profile.skills.find((item) => item.skillId === repair.skillId) ?? invalid("Skill not found.");
          const index = skill.aliases.findIndex((alias) => alias.alias === repair.alias);
          if (index >= 0) skill.aliases.splice(index, 1);
        } else {
          invalid("Open the editor to repair this item.");
        }
      });
    },

    createPosting(input: NewPosting) {
      return mutate((draft) => {
        const clean = cleanPosting(input);
        const posting = {
          postingId: newId(),
          versionId: newId(),
          kind: "job" as const,
          organisation: clean.organisation,
          title: clean.title,
          body: clean.body,
          sha256: sha256Hex(clean.body),
          url: clean.url,
          createdAt: now(),
        };
        const requirements: RequirementVersion[] = extractRequirements(clean.body).map((item, ordinal) => ({
          requirementId: newId(),
          versionId: newId(),
          postingVersionId: posting.versionId,
          ordinal,
          quote: item.quote,
          clause: item.clause,
          priority: item.priority,
          flags: item.flags,
          reviewed: false,
          removed: false,
        }));
        const app: Application = {
          applicationId: newId(),
          postingId: posting.postingId,
          stage: "saved",
          revision: 0,
          notes: "",
          selectedPacketId: null,
          selectedPacketRevision: null,
          updatedAt: posting.createdAt,
        };
        draft.postings.push(posting);
        draft.applications.push(app);
        draft.requirementSets.push({ postingVersionId: posting.versionId, revision: 1, requirements });
        draft.mappings.push({
          postingVersionId: posting.versionId,
          requirementSetRevision: 1,
          revision: 1,
          evidence: proposeEvidence(requirements, draft.profile),
        });
        return { postingId: posting.postingId, applicationId: app.applicationId };
      });
    },

    saveRequirements(postingVersionId, expectedRevision, edits: RequirementEdit[]) {
      return mutate((draft) => {
        const set = latestRequirementSet(draft, postingVersionId) ?? invalid("Posting not found.");
        if (set.revision !== expectedRevision) throw new RepoError("stale", "Requirements changed elsewhere. Reload and review again.");
        const posting = draft.postings.find((item) => item.versionId === postingVersionId) ?? invalid("Posting not found.");
        const requirements = nextRequirements(set, postingVersionId, cleanRequirementEdits(edits), newId, posting.body);
        const nextSet = { postingVersionId, revision: set.revision + 1, requirements };
        draft.requirementSets.push(nextSet);
        const mapping = latestMapping(draft, postingVersionId)!;
        draft.mappings.push({
          postingVersionId,
          requirementSetRevision: nextSet.revision,
          revision: mapping.revision + 1,
          evidence: proposeEvidence(requirements, draft.profile, mapping.evidence),
        });
      });
    },

    confirmEvidence(postingVersionId, expectedMappingRevision, requirementId, decision: EvidenceDecision | null) {
      return mutate((draft) => {
        const mapping = latestMapping(draft, postingVersionId) ?? invalid("Posting not found.");
        if (mapping.revision !== expectedMappingRevision) throw new RepoError("stale", "Evidence changed elsewhere. Reload and confirm again.");
        const set = latestRequirementSet(draft, postingVersionId)!;
        const requirement = set.requirements.find((item) => item.requirementId === requirementId) ?? invalid("Unknown requirement.");
        const clean = cleanDecision(decision);
        if (clean) requireCurrentFacts(draft, clean.facts);
        const evidence = confirmInEvidence(mapping.evidence, requirement, clean, now());
        draft.mappings.push({ ...mapping, revision: mapping.revision + 1, evidence });
      });
    },

    refreshProposals(postingVersionId) {
      return mutate((draft) => {
        const mapping = latestMapping(draft, postingVersionId) ?? invalid("Posting not found.");
        const set = latestRequirementSet(draft, postingVersionId)!;
        const evidence = proposeEvidence(set.requirements, draft.profile, mapping.evidence);
        if (digest(evidence) === digest(mapping.evidence)) return;
        draft.mappings.push({ ...mapping, revision: mapping.revision + 1, evidence });
      });
    },

    savePacketRevision(applicationId, packetId, expectedRevision, lines: PacketLine[]) {
      return mutate((draft) => {
        const app = application(draft, applicationId);
        const posting = latestPostingVersion(draft, app.postingId) ?? invalid("Posting not found.");
        const clean = cleanLines(lines);
        const id = packetId ?? newId();
        const latest = latestPacket(draft, id);
        if ((latest?.revision ?? null) !== expectedRevision) {
          throw new RepoError("stale", "The packet changed elsewhere. Reload before editing.");
        }
        if (latest && latest.applicationId !== applicationId) invalid("Packet belongs to another application.");
        const revision: PacketRevision = {
          packetId: id,
          applicationId,
          postingVersionId: posting.versionId,
          revision: (latest?.revision ?? 0) + 1,
          parentRevision: latest?.revision ?? null,
          lines: clean,
          createdAt: now(),
        };
        draft.packets.push(revision);
        return revision;
      });
    },

    approvePacket(packetId, revision, expectedRenderedSha256, requestId): Promise<ApproveResult> {
      return mutate((draft) => {
        const packet = latestPacket(draft, packetId) ?? invalid("Packet not found.");
        if (packet.revision !== revision) throw new RepoError("stale", "A newer packet revision exists. Review it before approving.");
        const app = application(draft, packet.applicationId);
        const posting = draft.postings.find((item) => item.versionId === packet.postingVersionId) ?? invalid("Posting not found.");
        if (latestPostingVersion(draft, app.postingId)?.versionId !== posting.versionId) {
          throw new RepoError("stale", "The posting changed. Rebuild the packet.");
        }
        const set = latestRequirementSet(draft, posting.versionId)!;
        const mapping = latestMapping(draft, posting.versionId)!;
        const selected = packet.lines.flatMap((line) => (line.kind === "fact" ? [line.fact] : []));
        const blocking = blockingProblems(validateProfile(draft.profile), selected);
        if (blocking.length > 0) throw new RepoError("blocked", `Repair profile health first: ${blocking[0].reason}`);
        const result = gatePacket(packet, { profile: draft.profile, posting });
        if (!result.approvable) throw new RepoError("blocked", result.refusal ?? "Packet is not approvable.");
        const binding = computeBinding({
          applicationId: app.applicationId,
          posting,
          requirementSetRevision: set.revision,
          mappingRevision: mapping.revision,
          revision: packet,
          profile: draft.profile,
        });
        if (expectedRenderedSha256 && expectedRenderedSha256 !== binding.renderedSha256) {
          throw new RepoError("stale", "The packet text changed since you reviewed it.");
        }
        const shaOfBinding = bindingSha256(binding);
        const existing = draft.approvals.find((item) => item.packetId === packetId && item.bindingSha256 === shaOfBinding);
        const approval = existing ?? {
          packetId,
          revision,
          renderedSha256: binding.renderedSha256,
          bindingSha256: shaOfBinding,
          binding,
          wordingAttested: false,
          approvedAt: now(),
          source: "demo_local" as const,
        };
        if (!existing) draft.approvals.push(approval);
        app.selectedPacketId = packetId;
        app.selectedPacketRevision = revision;
        const target = stageAfterApproval(app.stage);
        if (target !== app.stage) moveStage(draft, app, target, `approve-${requestId}`);
        return { approval, lines: result.lines, export: exportPacket(result.lines), receipt: "demo_local" as const };
      });
    },

    addReply(applicationId, body) {
      return mutate((draft) => {
        const app = application(draft, applicationId);
        const posting = latestPostingVersion(draft, app.postingId);
        const clean = cleanReplyBody(body);
        const reply = {
          replyId: newId(),
          applicationId,
          body: clean,
          prediction: classifyReply(clean, posting ? { organisation: posting.organisation, title: posting.title } : null),
          chosenLabel: null,
          confirmedAt: null,
          createdAt: now(),
        };
        draft.replies.push(reply);
        return reply;
      });
    },

    applyStageChange(request: StageChangeRequest): Promise<StageChangeResult> {
      return mutate((draft) => {
        requireStage(request.toStage);
        const app = draft.applications.find((item) => item.applicationId === request.applicationId);
        if (!app) return { ok: false as const, code: "forbidden" as const, message: "Application not found." };
        const result = applyStageModel({ application: app, replies: draft.replies, history: draft.stageHistory }, request, now(), newId);
        if (!result.ok) return result;
        const replay = draft.stageHistory.some((record) => record.requestId === request.requestId);
        if (replay) return result; // identical retry: nothing new is written
        Object.assign(app, result.application);
        draft.events.push(result.event);
        if (result.reply) {
          const index = draft.replies.findIndex((item) => item.replyId === result.reply!.replyId);
          draft.replies[index] = result.reply;
        }
        draft.stageHistory.push({ requestId: request.requestId, fingerprint: stageRequestFingerprint(request), result });
        return result;
      });
    },

    saveNotes(applicationId, notes) {
      return mutate((draft) => {
        const app = application(draft, applicationId);
        if (notes.length > LIMITS.notesChars) invalid("Notes are limited to 4000 characters.");
        app.notes = notes;
        app.updatedAt = now();
      });
    },
  };
}
