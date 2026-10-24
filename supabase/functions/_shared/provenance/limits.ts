export const LIMITS = {
  postingChars: 20_000,
  promptPostingChars: 12_000,
  factTextChars: 2_000,
  factSurfaceChars: 200,
  factSurfaceMin: 2,
  emailChars: 20_000,
  factsPerUser: 200,
  requirementsPerPosting: 40,
  bulletsPerDraft: 8,
  coverLinesPerDraft: 6,
  modelBullets: 12,
  modelCoverLines: 6,
  bulletChars: 500,
  headingChars: 80,
  factIdsPerLine: 8,
  modelDraftsPerUtcDay: 20,
  modelTimeoutMs: 25_000,
} as const;

export const REVIEW_THRESHOLD = 0.85;

export const MODEL_ID = "grok-4.7";

export const MODEL_URL = "https://api.x.ai/v1/responses";
