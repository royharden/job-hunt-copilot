// Capability labels (PLAN section 8). Every operation the UI offers is labelled so a fixture success is never
// mistaken for provider or database acceptance.
//   local       - runs the same pure TypeScript core the server uses, entirely in this browser
//   rehearsed   - a stand-in for a server action: same rules, but no server receipt or database write
//   server      - decided by the database/edge function in live mode (authored, not yet exercised)
//   unavailable - not offered in this mode or not built in the MVP

export type CapabilityLabel = "local" | "rehearsed" | "server" | "unavailable";

export interface Capability {
  id: string;
  name: string;
  demo: CapabilityLabel;
  live: CapabilityLabel;
  note: string;
}

export const CAPABILITIES: Capability[] = [
  { id: "profile.health", name: "Profile health and repairs", demo: "local", live: "local", note: "Pure core; the server re-checks selected evidence at approval." },
  { id: "posting.extract", name: "Requirement proposals from pasted text", demo: "local", live: "local", note: "Deterministic rules; you review every clause." },
  { id: "evidence.propose", name: "Exact / lexical / partial / gap proposals", demo: "local", live: "local", note: "Word overlap is not proof; every counted link is confirmed by you." },
  { id: "coverage", name: "Profile and packet coverage", demo: "local", live: "local", note: "Transparent arithmetic, not a hiring probability." },
  { id: "packet.guard", name: "Line rendering and guard preview", demo: "local", live: "local", note: "Preview only. In live mode the server decides approval." },
  { id: "packet.approve", name: "Approve and export packet", demo: "rehearsed", live: "server", note: "Demo approval is computed locally with no server receipt. Live approval comes from the draft-approve function (not yet exercised)." },
  { id: "board.stage", name: "Board stage change with history", demo: "rehearsed", live: "server", note: "Demo models the apply_stage_change transaction in browser storage; live mode calls the database RPC." },
  { id: "reply.rules", name: "Pasted reply rule suggestions", demo: "local", live: "local", note: "Rule evidence only; your confirmation records the event." },
  { id: "model.rewording", name: "Model rewording (optional M6)", demo: "unavailable", live: "unavailable", note: "Not part of the MVP. Off by default; no provider is called." },
  { id: "send", name: "Sending applications or email", demo: "unavailable", live: "unavailable", note: "Never offered. You submit applications yourself." },
];

export function labelFor(id: string, mode: "demo" | "remote"): CapabilityLabel {
  const capability = CAPABILITIES.find((item) => item.id === id);
  if (!capability) return "unavailable";
  return mode === "demo" ? capability.demo : capability.live;
}
