import { LIMITS } from "./limits.ts";
import { significantTokens } from "./normalize.ts";

const BULLET_RE = /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/;
const SIGNAL_RE =
  /\b(required|requirements|must|experience with|proficient|eligibility|eligible|qualification|qualifications)\b/i;

function cleanRequirement(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function worthKeeping(text: string): boolean {
  if (significantTokens(text).length > 0) return true;
  return /\byears?\b/i.test(text) && /\d/.test(text);
}

export function extractRequirements(raw: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.length > 240) continue;
    const bullet = trimmed.match(BULLET_RE);
    const candidate = bullet ? cleanRequirement(bullet[1]) : SIGNAL_RE.test(trimmed) ? cleanRequirement(trimmed) : "";
    if (candidate.length === 0 || !worthKeeping(candidate)) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(candidate);
    if (found.length >= LIMITS.requirementsPerPosting) break;
  }
  return found;
}
