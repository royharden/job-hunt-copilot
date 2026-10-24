import { describe, expect, it } from "vitest";
import { factFromRow, packetFromRow, roleFromRow } from "../supabase/functions/_shared/provenance/rows.ts";
import { currentFactVersion } from "../supabase/functions/_shared/provenance/versions.ts";

describe("row mapping", () => {
  // what_bug_this_catches: SQL "current version" (newest decided_at) and the TS core (newest createdAt)
  // disagreeing, so the browser previews a version the server considers stale.
  it("maps decided_at into createdAt so current-version rules agree with SQL", () => {
    const base = {
      fact_id: "f1",
      kind: "accomplishment",
      body: "Built things.",
      role_id: null,
      role_version_id: null,
      project_label: null,
      origin: { type: "user_attestation", statement: "Built things.", attestedAt: "2026-10-01T00:00:00Z" },
      approved_at: null,
      withdrawn_at: null,
    };
    // v2 was created later as a draft but v1 was approved after it: SQL orders by decided_at.
    const v1 = factFromRow({ ...base, version_id: "v1", status: "approved", created_at: "2026-10-01T00:00:00Z", decided_at: "2026-10-05T00:00:00Z" });
    const v2 = factFromRow({ ...base, version_id: "v2", status: "approved", created_at: "2026-10-03T00:00:00Z", decided_at: "2026-10-04T00:00:00Z" });
    const draft = factFromRow({ ...base, version_id: "v3", status: "draft", created_at: "2026-10-06T00:00:00Z", decided_at: null });
    expect(currentFactVersion([v1, v2, draft], "f1")?.versionId).toBe("v1");
    expect(draft.createdAt).toBe("2026-10-06T00:00:00Z");
    expect(v1.roleRef).toBeNull();
  });

  it("maps role and packet columns", () => {
    const role = roleFromRow({
      role_id: "r1",
      version_id: "rv1",
      employer: "Contoso Ltd",
      title: "Billing Engineer",
      start_month: "2019-03",
      end_month: null,
      is_current: true,
      as_of: "2026-10",
      status: "approved",
      approved_at: "2026-10-01T00:00:00Z",
      decided_at: "2026-10-01T00:00:00Z",
      created_at: "2026-09-30T00:00:00Z",
    });
    expect(role).toMatchObject({ start: "2019-03", end: null, current: true, createdAt: "2026-10-01T00:00:00Z" });
    const packet = packetFromRow({
      packet_id: "p1",
      revision: 2,
      parent_revision: 1,
      application_id: "a1",
      posting_version_id: "pv1",
      lines: [],
      created_at: "2026-10-02T00:00:00Z",
    });
    expect(packet).toMatchObject({ packetId: "p1", revision: 2, parentRevision: 1, applicationId: "a1", postingVersionId: "pv1" });
  });
});
