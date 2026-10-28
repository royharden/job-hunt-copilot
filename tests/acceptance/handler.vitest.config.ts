import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "https://esm.sh/@supabase/supabase-js@2.49.1": fileURLToPath(new URL("./handler-sdk.ts", import.meta.url)) } },
  test: { environment: "node", include: ["tests/acceptance/handler.spec.ts"], maxWorkers: 1, minWorkers: 1 },
});
