export const LIMITS = {
  sourceChars: 30_000,
  postingChars: 20_000,
  replyChars: 20_000,
  factTextChars: 500,
  factsPerUser: 200,
  rolesPerUser: 60,
  skillsPerUser: 200,
  aliasesPerSkill: 12,
  aliasChars: 60,
  requirementsPerPosting: 40,
  requirementChars: 300,
  packetLines: 40,
  lineChars: 500,
  notesChars: 4_000,
  titleChars: 200,
} as const;

// Server/config-owned versions bound into every approval. Bump when rules change so old approvals go stale.
export const GUARD_VERSION = "guard-v1";
export const TEMPLATE_VERSION = "templates-v1";
export const REPLY_RULES_VERSION = "reply-rules-v1";

// Proposal heuristic only (PLAN section 6). Not proof of support.
export const LEXICAL_JACCARD = 0.34;
export const LEXICAL_MIN_SHARED = 2;
