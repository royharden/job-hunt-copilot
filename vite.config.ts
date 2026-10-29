import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Agent-local browser profiles contain locked Windows cache files, not application source.
  server: { watch: { ignored: ["**/.agent-work/**"] } },
});
