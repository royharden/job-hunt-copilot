// draft-approve: authenticated validation, approval and export (PLAN section 5). No model call.
//
// POST {packet_id, revision, expected_rendered_sha256?, request_id, wording_attested:false}
// 200  {packet:{id,revision,lines,findings,rendered_sha256,input_binding,approval}, export:{plain_text,markdown}, request_id}
// 4xx/5xx {error:{code,message}} with code in unauthorized|forbidden|invalid_input|missing_config|blocked|stale|conflict|unavailable
//
// Flow: verify the caller's JWT -> read the owner's rows WITH THE CALLER'S TOKEN (RLS proves ownership) ->
// recompute rendering, guard, health and the full binding with the shared core -> call the service-only
// commit_guard_result, which locks and re-compares every current input in one transaction. Client grades,
// hashes or approval flags are never read. Dirty Mode construction: authored, never deployed or run.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, errorResponse, HttpError, json } from "../_shared/http.ts";
import { bindingSha256, computeBinding } from "../_shared/provenance/binding.ts";
import { exportPacket, gatePacket } from "../_shared/provenance/gate.ts";
import { GUARD_VERSION, TEMPLATE_VERSION } from "../_shared/provenance/limits.ts";
import {
  TABLES,
  factFromRow,
  mappingFromRow,
  packetFromRow,
  postingFromRow,
  requirementSetFromRow,
  roleFromRow,
  skillEvidenceFromRow,
  skillFromRow,
  sourceFromRow,
} from "../_shared/provenance/rows.ts";
import type { Profile } from "../_shared/provenance/types.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ApproveRequest {
  packetId: string;
  revision: number;
  expectedRenderedSha256: string | null;
  requestId: string;
}

function parseRequest(body: unknown): ApproveRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError("invalid_input", "Body must be a JSON object.");
  const record = body as Record<string, unknown>;
  const packetId = record.packet_id;
  const revision = record.revision;
  const requestId = record.request_id;
  const expected = record.expected_rendered_sha256 ?? null;
  if (typeof packetId !== "string" || !UUID_RE.test(packetId)) throw new HttpError("invalid_input", "packet_id must be a UUID.");
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) throw new HttpError("invalid_input", "revision must be a positive integer.");
  if (typeof requestId !== "string" || !UUID_RE.test(requestId)) throw new HttpError("invalid_input", "request_id must be a UUID.");
  if (expected !== null && (typeof expected !== "string" || !/^[0-9a-f]{64}$/.test(expected))) {
    throw new HttpError("invalid_input", "expected_rendered_sha256 must be 64 lowercase hex characters.");
  }
  // MVP exports verified lines only; wording attestation belongs to the optional M6 path, which is not built.
  if (record.wording_attested !== false && record.wording_attested !== undefined) {
    throw new HttpError("invalid_input", "wording_attested is not supported in this version.");
  }
  return { packetId, revision, expectedRenderedSha256: expected as string | null, requestId };
}

type Rows = Array<Record<string, unknown>>;

Deno.serve(async (request: Request): Promise<Response> => {
  const cors = corsHeaders(Deno.env.get("ALLOWED_ORIGIN"));
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return errorResponse("invalid_input", "Use POST.", cors);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return errorResponse("missing_config", "Server configuration is incomplete.", cors);

  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  if (!token || token === anonKey) return errorResponse("unauthorized", "Sign in first.", cors);

  try {
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData?.user) return errorResponse("unauthorized", "Session is not valid.", cors);
    const ownerId = userData.user.id;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("invalid_input", "Body must be JSON.", cors);
    }
    const input = parseRequest(body);

    const read = async (table: string, filter?: (query: any) => any): Promise<Rows> => {
      let query = userClient.from(table).select("*");
      if (filter) query = filter(query);
      const { data, error } = await query;
      if (error) throw new HttpError("unavailable", "Could not read workspace.");
      return (data ?? []) as Rows;
    };

    // Profile revision is read FIRST: any profile change after this point makes the commit stale.
    const ownerState = await read(TABLES.ownerState);
    const profileRevision = Number(ownerState[0]?.profile_revision ?? 0);

    const packetRows = await read(TABLES.packets, (query) => query.eq("packet_id", input.packetId));
    if (packetRows.length === 0) return errorResponse("forbidden", "Packet not found.", cors);
    const packets = packetRows.map(packetFromRow).sort((left, right) => right.revision - left.revision);
    const packet = packets.find((item) => item.revision === input.revision);
    if (!packet) return errorResponse("forbidden", "Packet revision not found.", cors);
    if (packets[0].revision !== input.revision) return errorResponse("stale", "A newer packet revision exists.", cors);

    const appRows = await read(TABLES.applications, (query) => query.eq("application_id", packet.applicationId));
    if (appRows.length !== 1) return errorResponse("forbidden", "Application not found.", cors);
    const postingId = String(appRows[0].posting_id);
    const postings = (await read(TABLES.postings, (query) => query.eq("posting_id", postingId)))
      .map(postingFromRow)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const posting = postings[0];
    if (!posting || posting.versionId !== packet.postingVersionId) return errorResponse("stale", "The posting changed. Rebuild the packet.", cors);

    const sets = (await read(TABLES.requirementSets, (query) => query.eq("posting_version_id", posting.versionId))).map(requirementSetFromRow);
    const mappings = (await read(TABLES.mappings, (query) => query.eq("posting_version_id", posting.versionId))).map(mappingFromRow);
    const requirementSetRevision = Math.max(0, ...sets.map((item) => item.revision));
    const mappingRevision = Math.max(0, ...mappings.map((item) => item.revision));

    const [sources, roles, facts, skills, links] = await Promise.all([
      read(TABLES.sources),
      read(TABLES.roles),
      read(TABLES.facts),
      read(TABLES.skills),
      read(TABLES.skillEvidence),
    ]);
    const profile: Profile = {
      sources: sources.map(sourceFromRow),
      roles: roles.map(roleFromRow),
      facts: facts.map(factFromRow),
      skills: skills.map(skillFromRow),
      skillEvidence: links.map(skillEvidenceFromRow),
    };

    // Server-side reconstruction: templates and approved sentences are rendered from current sources here.
    const gate = gatePacket(packet, { profile, posting });
    if (!gate.approvable) {
      return errorResponse("blocked", gate.refusal ?? "Packet is not approvable.", cors, { lines: gate.lines });
    }
    const binding = computeBinding({
      applicationId: packet.applicationId,
      posting,
      requirementSetRevision,
      mappingRevision,
      revision: packet,
      profile,
    });
    if (input.expectedRenderedSha256 && input.expectedRenderedSha256 !== binding.renderedSha256) {
      return errorResponse("stale", "The packet text changed since you reviewed it.", cors);
    }
    const bindingDigest = bindingSha256(binding);

    const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: commit, error: commitError } = await service.rpc("commit_guard_result", {
      p_owner: ownerId,
      p_request_id: input.requestId,
      p_packet_id: packet.packetId,
      p_revision: packet.revision,
      p_profile_revision: profileRevision,
      p_binding: binding,
      p_binding_sha256: bindingDigest,
      p_rendered_sha256: binding.renderedSha256,
      p_rendered_lines: gate.lines,
      p_guard_version: GUARD_VERSION,
      p_template_version: TEMPLATE_VERSION,
    });
    if (commitError) return errorResponse("unavailable", "Approval could not be recorded.", cors);
    const result = commit as { ok: boolean; code?: string; approvedAt?: string };
    if (!result.ok) {
      const code = result.code === "conflict" ? "conflict" : result.code === "forbidden" ? "forbidden" : "stale";
      return errorResponse(code, code === "stale" ? "Inputs changed while approving. Reload and review again." : "Request refused.", cors);
    }

    const exported = exportPacket(gate.lines);
    return json(
      {
        packet: {
          id: packet.packetId,
          revision: packet.revision,
          lines: gate.lines,
          findings: gate.lines.flatMap((line) => line.findings),
          rendered_sha256: binding.renderedSha256,
          input_binding: binding,
          approval: {
            packetId: packet.packetId,
            revision: packet.revision,
            renderedSha256: binding.renderedSha256,
            bindingSha256: bindingDigest,
            binding,
            wordingAttested: false,
            approvedAt: result.approvedAt ?? new Date().toISOString(),
            source: "server",
          },
        },
        export: { plain_text: exported.plainText, markdown: exported.markdown },
        request_id: input.requestId,
      },
      200,
      cors,
    );
  } catch (caught) {
    if (caught instanceof HttpError) return errorResponse(caught.code, caught.message, cors);
    // Metadata-only diagnostics: no request body, packet text or personal data in logs.
    console.error("draft-approve failed", caught instanceof Error ? caught.name : "unknown");
    return errorResponse("unavailable", "Unexpected server error.", cors);
  }
});
