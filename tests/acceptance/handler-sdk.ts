// Isolated SDK substitute: no environment, HTTP client, token parsing or hosted Auth.
export const scenario = {
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  calls: [] as Array<{ key: string; options: unknown }>,
  commits: [] as Array<Record<string, unknown>>,
  owner: "10000000-0000-4000-8000-000000000001",
  invalidUser: false,
  readError: false,
  commitError: false,
  commit: { ok: true, approvedAt: "2026-10-26T00:00:00.000Z" } as Record<string, unknown>,
};
export function createClient(_url: string, key: string, options: unknown) {
  scenario.calls.push({ key, options });
  return {
    auth: { getUser: async () => ({ data: { user: scenario.invalidUser ? null : { id: scenario.owner } }, error: null }) },
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const query = {
        select() { return query; },
        eq(column: string, value: unknown) { filters.push([column, value]); return query; },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: (scenario.rows[table] ?? []).filter((row) => filters.every(([column, value]) => row[column] === value)),
            error: scenario.readError ? { message: "fixture-read-failure" } : null }).then(resolve);
        },
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      if (name !== "commit_guard_result" || key !== "rv-service-fixture") throw new Error("Unexpected privileged call");
      scenario.commits.push(args);
      return { data: scenario.commit, error: scenario.commitError ? { message: "fixture-backend-detail" } : null };
    },
  };
}
