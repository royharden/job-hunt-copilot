import { approvalIsCurrent, bindingSha256, computeBinding, staleReasons } from "../../supabase/functions/_shared/provenance/binding.ts";
import { gatePacket, type GateResult } from "../../supabase/functions/_shared/provenance/gate.ts";
import type { Approval, InputBinding, PacketRevision, PostingVersion } from "../../supabase/functions/_shared/provenance/types.ts";
import { latestMapping, latestPacket, latestPostingVersion, latestRequirementSet } from "./workspace.ts";
import type { Workspace } from "./repository.ts";

// Browser-side preview of a packet's state. It never confers authority: in live mode the server recomputes
// everything at approval and export; here it only drives labels and buttons.

export interface PacketStatus {
  posting: PostingVersion;
  packet: PacketRevision | null;
  gate: GateResult | null;
  binding: InputBinding | null;
  approval: Approval | null; // newest approval for this packet, current or not
  approvalCurrent: boolean;
  staleBecause: string[];
}

export function packetStatus(workspace: Workspace, applicationId: string): PacketStatus | null {
  const app = workspace.applications.find((item) => item.applicationId === applicationId);
  if (!app) return null;
  const posting = latestPostingVersion(workspace, app.postingId);
  if (!posting) return null;
  const packetIds = [...new Set(workspace.packets.filter((item) => item.applicationId === applicationId).map((item) => item.packetId))];
  const packetId = app.selectedPacketId ?? packetIds[packetIds.length - 1] ?? null;
  const packet = packetId ? latestPacket(workspace, packetId) ?? null : null;
  if (!packet) {
    return { posting, packet: null, gate: null, binding: null, approval: null, approvalCurrent: false, staleBecause: [] };
  }
  const gate = gatePacket(packet, { profile: workspace.profile, posting });
  const set = latestRequirementSet(workspace, posting.versionId);
  const mapping = latestMapping(workspace, posting.versionId);
  const binding = computeBinding({
    applicationId,
    posting,
    requirementSetRevision: set?.revision ?? 0,
    mappingRevision: mapping?.revision ?? 0,
    revision: packet,
    profile: workspace.profile,
  });
  const approvals = workspace.approvals
    .filter((item) => item.packetId === packet.packetId)
    .sort((left, right) => right.approvedAt.localeCompare(left.approvedAt));
  const approval = approvals[0] ?? null;
  const current = approvalIsCurrent(approval, binding);
  return {
    posting,
    packet,
    gate,
    binding,
    approval,
    approvalCurrent: current,
    staleBecause: approval && !current ? staleReasons(approval.binding, binding) : [],
  };
}

export function bindingDigest(binding: InputBinding): string {
  return bindingSha256(binding);
}
