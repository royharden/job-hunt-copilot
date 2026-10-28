import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { scenario } from "./handler-sdk.ts";
import { sha256Hex } from "../../supabase/functions/_shared/provenance/hash.ts";

const packetId = "20000000-0000-4000-8000-000000000001";
const appId = "30000000-0000-4000-8000-000000000001";
const postingId = "40000000-0000-4000-8000-000000000001";
const postingVersionId = "40000000-0000-4000-8000-000000000002";
const factId = "50000000-0000-4000-8000-000000000001";
const factVersionId = "50000000-0000-4000-8000-000000000002";
const requestId = "60000000-0000-4000-8000-000000000001";
const sentence = "Wrote regression checks for the Juniper sandbox.";
let handler: (request: Request) => Promise<Response>;
const env = new Map<string, string>();
const payload = () => ({ packet_id: packetId, revision: 1, request_id: requestId, wording_attested: false });
async function call(body: unknown = payload(), token: string | null = "rv-user-fixture", method = "POST") {
  const response = await handler(new Request("http://127.0.0.1/draft-approve", { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}) }));
  return { status: response.status, body: method === "OPTIONS" ? await response.text() : await response.json() };
}

describe("RV isolated approval-handler contract", () => {
  beforeAll(async () => {
    vi.stubGlobal("Deno", { env: { get: (key: string) => env.get(key) }, serve: (callback: typeof handler) => { handler = callback; } });
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden by RV handler harness"); }));
    const modulePath = "../../supabase/functions/draft-approve/index.ts";
    await import(modulePath);
  });
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => {
    env.clear(); env.set("SUPABASE_URL", "http://127.0.0.1/fixture");
    env.set("SUPABASE_ANON_KEY", "rv-public-fixture"); env.set("SUPABASE_SERVICE_ROLE_KEY", "rv-service-fixture");
    scenario.calls.length = 0; scenario.commits.length = 0;
    scenario.invalidUser = false; scenario.readError = false; scenario.commitError = false;
    scenario.commit = { ok: true, approvedAt: "2026-10-26T00:00:00.000Z" };
    scenario.rows = {
      owner_state: [{ profile_revision: 17 }],
      packet_revisions: [{ packet_id: packetId, application_id: appId, posting_version_id: postingVersionId, revision: 1,
        parent_revision: null, created_at: "2026-10-26", lines: [{ lineId: "rv", kind: "fact", section: "experience",
          fact: { factId, versionId: factVersionId }, proposalText: sentence, requirementIds: [] }] }],
      applications: [{ application_id: appId, posting_id: postingId }],
      posting_versions: [{ posting_id: postingId, version_id: postingVersionId, organisation: "Juniper Test Labs", title: "QA Analyst",
        body: "Required: regression checks", sha256: sha256Hex("Required: regression checks"), created_at: "2026-10-26" }],
      requirement_sets: [{ posting_version_id: postingVersionId, revision: 3, requirements: [] }],
      evidence_mappings: [{ posting_version_id: postingVersionId, revision: 4, requirement_set_revision: 3, evidence: [] }],
      fact_versions: [{ fact_id: factId, version_id: factVersionId, kind: "accomplishment", body: sentence, status: "approved",
        origin: { type: "user_attestation", statement: sentence, attestedAt: "2026-10-25" },
        approved_at: "2026-10-25", created_at: "2026-10-25" }],
    };
  });

  // what_bug_this_catches: preflight/method/config/auth failures reaching privileged writes or leaking config.
  it("handles preflight and rejects invalid methods without SDK calls", async () => {
    expect(await call(undefined, null, "OPTIONS")).toMatchObject({ status: 200 });
    expect((await call(undefined, null, "GET")).body.error.code).toBe("invalid_input");
    expect(scenario.calls).toHaveLength(0);
  });
  it.each(["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"])("fails closed when %s is absent", async (key) => {
    env.delete(key); const result = await call();
    expect(result.body.error.code).toBe("missing_config");
    expect(JSON.stringify(result.body)).not.toContain("rv-service-fixture"); expect(scenario.calls).toHaveLength(0);
  });
  it.each([null, "rv-public-fixture"])("rejects absent/anonymous bearer %s", async (token) => {
    expect((await call(payload(), token)).body.error.code).toBe("unauthorized");
    expect(scenario.calls).toHaveLength(0);
  });
  it("rejects invalid identity and malformed schema without commit", async () => {
    scenario.invalidUser = true; expect((await call()).body.error.code).toBe("unauthorized");
    scenario.invalidUser = false;
    for (const body of [null, [], { ...payload(), packet_id: "bad" }, { ...payload(), revision: 0 },
      { ...payload(), request_id: "bad" }, { ...payload(), wording_attested: true }]) {
      expect((await call(body)).body.error.code).toBe("invalid_input");
    }
    expect(scenario.commits).toHaveLength(0);
  });
  it("rejects hidden/foreign packet and a superseded revision", async () => {
    const rows = scenario.rows.packet_revisions;
    scenario.rows.packet_revisions = []; expect((await call()).body.error.code).toBe("forbidden");
    scenario.rows.packet_revisions = [...rows, { ...rows[0], revision: 2 }];
    expect((await call()).body.error.code).toBe("stale"); expect(scenario.commits).toHaveLength(0);
  });
  it("does not approve empty or edited wording even when caller forges grades", async () => {
    const packet = scenario.rows.packet_revisions[0]; const lines = packet.lines;
    packet.lines = []; expect((await call()).body.error.code).toBe("blocked");
    packet.lines = (lines as Array<Record<string, unknown>>).map((line) => ({ ...line, proposalText: "Led all regression efforts." }));
    expect((await call({ ...payload(), approvable: true, grade: "verified" })).body.error.code).toBe("blocked");
    expect(scenario.commits).toHaveLength(0);
  });
  it("rejects unexpected reviewed hash before acquiring service client", async () => {
    expect((await call({ ...payload(), expected_rendered_sha256: "0".repeat(64) })).body.error.code).toBe("stale");
    expect(scenario.calls.map((item) => item.key)).toEqual(["rv-public-fixture"]);
  });
  it.each(["stale", "conflict", "forbidden"])("propagates service refusal %s without export", async (code) => {
    scenario.commit = { ok: false, code };
    const result = await call(); expect(result.body.error.code).toBe(code); expect(result.body.export).toBeUndefined();
  });
  it("hides backend error details on read and commit failures", async () => {
    scenario.readError = true; expect((await call()).body.error.code).toBe("unavailable");
    scenario.readError = false; scenario.commitError = true; const result = await call();
    expect(result.body.error.code).toBe("unavailable"); expect(JSON.stringify(result)).not.toContain("fixture-backend-detail");
  });
  // what_bug_this_catches: trusting caller owner/binding/grade instead of server-derived bytes and current rows.
  it("reconstructs exact output and commits the complete current tuple as verified owner", async () => {
    const result = await call({ ...payload(), owner_id: "forged-owner", binding: {}, rendered_sha256: "forged", grade: "verified" });
    expect(result.status).toBe(200); expect(result.body.packet.approval.source).toBe("server");
    expect(result.body.export.plain_text).toContain(sentence);
    expect(result.body.packet.lines[0].grade).toBe("verified");
    expect(scenario.commits).toHaveLength(1);
    const commit = scenario.commits[0];
    expect(commit).toMatchObject({ p_owner: scenario.owner, p_request_id: requestId, p_profile_revision: 17,
      p_revision: 1, p_guard_version: "guard-v1", p_template_version: "templates-v1" });
    expect(commit.p_binding).toMatchObject({ applicationId: appId, postingVersionId, requirementSetRevision: 3,
      mappingRevision: 4, factVersionIds: [factVersionId], packetId, packetRevision: 1 });
    expect(commit.p_rendered_sha256).toBe(result.body.packet.rendered_sha256);
    expect(scenario.calls[0].options).toMatchObject({ global: { headers: { Authorization: "Bearer rv-user-fixture" } } });
    expect(fetch).not.toHaveBeenCalled();
  });
});
