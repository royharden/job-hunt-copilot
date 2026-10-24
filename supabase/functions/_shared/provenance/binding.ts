import { aliasDigest, tenureDigest } from "./aliases.ts";
import { gatePacket } from "./gate.ts";
import { digest, sha256Hex } from "./hash.ts";
import { GUARD_VERSION, TEMPLATE_VERSION } from "./limits.ts";
import { templateKey } from "./templates.ts";
import { findFactVersion } from "./versions.ts";
import type { Approval, InputBinding, PacketRevision, PostingVersion, Profile } from "./types.ts";

// Full approval binding (PLAN section 5). Computed server-side for live approval; the demo computes the same
// tuple locally and labels the result as a demo-local approval with no server receipt.
// Any change to these inputs (posting, reviewed requirement set, confirmed mapping, selected fact/role/source
// versions, aliases, tenure assertions, packet revision/order/templates, rendered bytes, guard or template
// versions) produces a different bindingSha256, so an older approval stops authorizing export.

export interface BindingInputs {
  applicationId: string;
  posting: PostingVersion;
  requirementSetRevision: number;
  mappingRevision: number;
  revision: PacketRevision;
  profile: Profile;
}

// The rendered bytes are always recomputed from current sources here, never taken from a caller, so a
// withdrawn or edited source changes the binding even when the packet revision is unchanged.
export function computeBinding(inputs: BindingInputs): InputBinding {
  const renderedText = gatePacket(inputs.revision, { profile: inputs.profile, posting: inputs.posting }).renderedText;
  const factVersionIds = new Set<string>();
  const roleVersionIds = new Set<string>();
  const sourceVersionIds = new Set<string>();
  const templates: string[] = [];
  for (const line of inputs.revision.lines) {
    if (line.kind === "fact") {
      factVersionIds.add(line.fact.versionId);
      const fact = findFactVersion(inputs.profile, line.fact);
      if (fact?.roleRef) roleVersionIds.add(fact.roleRef.roleVersionId);
      if (fact?.origin.type === "source_span") sourceVersionIds.add(fact.origin.documentVersionId);
    } else {
      templates.push(templateKey(line));
      if (line.role) roleVersionIds.add(line.role.roleVersionId);
    }
  }
  return {
    applicationId: inputs.applicationId,
    postingVersionId: inputs.posting.versionId,
    postingSha256: inputs.posting.sha256,
    requirementSetRevision: inputs.requirementSetRevision,
    mappingRevision: inputs.mappingRevision,
    factVersionIds: [...factVersionIds].sort(),
    roleVersionIds: [...roleVersionIds].sort(),
    sourceVersionIds: [...sourceVersionIds].sort(),
    aliasDigest: aliasDigest(inputs.profile.skills),
    tenureDigest: tenureDigest(inputs.profile),
    packetId: inputs.revision.packetId,
    packetRevision: inputs.revision.revision,
    lineOrder: inputs.revision.lines.map((line) => line.lineId),
    templates,
    renderedSha256: sha256Hex(renderedText),
    guardVersion: GUARD_VERSION,
    templateVersion: TEMPLATE_VERSION,
  };
}

export function bindingSha256(binding: InputBinding): string {
  return digest(binding);
}

// An approval authorizes export only while its binding equals the binding recomputed from current inputs.
// Historical approvals remain inspectable; they are simply not current.
export function approvalIsCurrent(approval: Approval | null, current: InputBinding): boolean {
  if (!approval) return false;
  return approval.bindingSha256 === bindingSha256(current) && approval.renderedSha256 === current.renderedSha256;
}

export function staleReasons(approved: InputBinding, current: InputBinding): string[] {
  const reasons: string[] = [];
  const keys = Object.keys(current) as Array<keyof InputBinding>;
  for (const key of keys) {
    if (digest(approved[key]) !== digest(current[key])) reasons.push(key);
  }
  return reasons;
}
