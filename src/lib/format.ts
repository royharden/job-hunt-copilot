import type { DraftRecord, PostingRecord } from "./repository.ts";

export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : "Something went wrong.";
}

export function withoutCitations(text: string): string {
  return text.replace(/\[\[fact:[^\]]+\]\]/g, " ").replace(/\s+/g, " ").trim();
}

export function approvedPlainText(posting: PostingRecord, draft: DraftRecord): string {
  const bullets = draft.bullets.map((bullet) => `• ${withoutCitations(bullet.text)}`);
  const cover = draft.cover.map((line) => `${line.heading}: ${withoutCitations(line.text)}`);
  return [posting.title, posting.organization, "", ...bullets, "", ...cover].filter((line) => line !== undefined).join("\n").trim();
}
