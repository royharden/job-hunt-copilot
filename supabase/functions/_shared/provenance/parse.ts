import { LIMITS } from "./limits.ts";
import type { CoverLine, DraftBullet } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > LIMITS.factIdsPerLine) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const id = item.trim();
    if (id.length === 0 || id.length > 80 || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
    ids.push(id);
  }
  return ids;
}

function readLine(value: unknown, withHeading: boolean): { heading?: string; text: string; factIds: string[] } | null {
  if (!isRecord(value)) return null;
  if (typeof value.text !== "string") return null;
  const text = value.text.trim();
  if (text.length === 0 || text.length > LIMITS.bulletChars) return null;
  const factIds = readIds(value.fact_ids);
  if (!factIds) return null;
  if (!withHeading) return { text, factIds };
  if (typeof value.heading !== "string") return null;
  const heading = value.heading.trim();
  if (heading.length === 0 || heading.length > LIMITS.headingChars) return null;
  return { heading, text, factIds };
}

export function parseModelDraft(raw: string): { bullets: DraftBullet[]; cover: CoverLine[] } | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || !Array.isArray(value.bullets) || !Array.isArray(value.cover_outline)) return null;
  if (value.bullets.length === 0 || value.bullets.length > LIMITS.modelBullets) return null;
  if (value.cover_outline.length > LIMITS.modelCoverLines) return null;
  const bullets: DraftBullet[] = [];
  for (const item of value.bullets) {
    const line = readLine(item, false);
    if (!line) return null;
    bullets.push({ text: line.text, factIds: line.factIds });
  }
  const cover: CoverLine[] = [];
  for (const item of value.cover_outline) {
    const line = readLine(item, true);
    if (!line?.heading) return null;
    cover.push({ heading: line.heading, text: line.text, factIds: line.factIds });
  }
  return { bullets, cover };
}

export interface ProviderResponse {
  output_text?: unknown;
  output?: unknown;
}

export function extractResponseText(body: ProviderResponse): string | null {
  if (typeof body.output_text === "string" && body.output_text.trim().length > 0) {
    return body.output_text;
  }
  if (!Array.isArray(body.output)) return null;
  for (const item of body.output) {
    if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (!isRecord(part) || part.type !== "output_text" || typeof part.text !== "string") continue;
      if (part.text.trim().length > 0) return part.text;
    }
  }
  return null;
}
