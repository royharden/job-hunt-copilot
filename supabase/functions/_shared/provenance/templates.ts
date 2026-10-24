import { TEMPLATE_VERSION } from "./limits.ts";
import { normalizeWhitespace } from "./normalize.ts";
import { findRoleVersion, isCurrentRole, roleDates } from "./versions.ts";
import type { Finding, PostingVersion, Profile, SourceRef, TemplateLine } from "./types.ts";

// Finite, code-rendered templates (PLAN section 7). Slots come only from typed current sources:
//   role_header          "Worked as {title} at {employer} during {dates}."   one approved current role version
//   application_opening  "I am applying for the {title} role at {organisation}."   reviewed posting target details,
//                        which are not career evidence
//   generic_closing      "Thank you for considering my application."   no career assertion

export interface TemplateRender {
  text: string | null;
  sources: SourceRef[];
  findings: Finding[];
}

export const TEMPLATE_TEXT = {
  role_header: "Worked as {title} at {employer} during {dates}.",
  application_opening: "I am applying for the {title} role at {organisation}.",
  generic_closing: "Thank you for considering my application.",
} as const;

export { TEMPLATE_VERSION };

function fill(template: string, slots: Record<string, string>): string {
  return normalizeWhitespace(template.replace(/\{(\w+)\}/g, (_match, key: string) => slots[key] ?? ""));
}

export function renderTemplate(line: TemplateLine, profile: Profile, posting: PostingVersion): TemplateRender {
  if (line.templateId === "generic_closing") {
    return { text: TEMPLATE_TEXT.generic_closing, sources: [], findings: [] };
  }
  if (line.templateId === "application_opening") {
    const title = posting.title.trim();
    const organisation = posting.organisation.trim();
    if (title.length === 0 || organisation.length === 0) {
      return { text: null, sources: [], findings: [{ code: "template_slot_missing", detail: "Posting title or organisation is empty." }] };
    }
    return {
      text: fill(TEMPLATE_TEXT.application_opening, { title, organisation }),
      sources: [{ kind: "posting", id: posting.postingId, versionId: posting.versionId, quote: `${title} at ${organisation}` }],
      findings: [],
    };
  }
  if (!line.role) {
    return { text: null, sources: [], findings: [{ code: "template_slot_missing", detail: "Role header has no role reference." }] };
  }
  const role = findRoleVersion(profile, line.role);
  if (!role) {
    return { text: null, sources: [], findings: [{ code: "phantom_ref", detail: "Role version does not exist in this profile." }] };
  }
  if (role.status !== "approved" || !isCurrentRole(profile, line.role)) {
    return { text: null, sources: [], findings: [{ code: "stale_ref", detail: "Role version is not the current approved version." }] };
  }
  const dates = roleDates(role);
  return {
    text: fill(TEMPLATE_TEXT.role_header, { title: role.title, employer: role.employer, dates }),
    sources: [{ kind: "role", id: role.roleId, versionId: role.versionId, quote: `${role.title} | ${role.employer} | ${dates}` }],
    findings: [],
  };
}

export function templateKey(line: TemplateLine): string {
  return `${TEMPLATE_VERSION}:${line.templateId}`;
}
