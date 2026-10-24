import type { PacketRevision } from "../../supabase/functions/_shared/provenance/types.ts";
import type { Workspace } from "./repository.ts";

// Pure selectors over a loaded workspace, shared by both adapters and the screens.

export function newest<T extends { createdAt: string }>(items: T[]): T | undefined {
  return [...items].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export function latestRequirementSet(state: Workspace, postingVersionId: string) {
  return state.requirementSets
    .filter((set) => set.postingVersionId === postingVersionId)
    .sort((left, right) => right.revision - left.revision)[0];
}

export function latestMapping(state: Workspace, postingVersionId: string) {
  return state.mappings.filter((map) => map.postingVersionId === postingVersionId).sort((left, right) => right.revision - left.revision)[0];
}

export function latestPacket(state: Workspace, packetId: string): PacketRevision | undefined {
  return state.packets.filter((packet) => packet.packetId === packetId).sort((left, right) => right.revision - left.revision)[0];
}

export function latestPostingVersion(state: Workspace, postingId: string) {
  return newest(state.postings.filter((posting) => posting.postingId === postingId));
}

