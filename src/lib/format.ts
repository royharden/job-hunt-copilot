import { RepoError } from "./repository.ts";

export function errorMessage(error: unknown): string {
  if (error instanceof RepoError) return error.message;
  return error instanceof Error && error.message.trim().length > 0 ? error.message : "Something went wrong.";
}

export function percentText(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(1)}%`;
}

export function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
