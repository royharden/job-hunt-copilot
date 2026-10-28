import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: { environment: "node", include: ["tests/acceptance/recovery-ui.spec.ts", "tests/acceptance/demo-ui.spec.ts"],
    setupFiles: ["tests/acceptance/ui-setup.ts"], maxWorkers: 1, minWorkers: 1 },
});
