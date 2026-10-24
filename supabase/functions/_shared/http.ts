// HTTP helpers for edge functions. CORS is not authentication: the JWT is.
// Stable error codes (PLAN section 5): unauthorized, forbidden, invalid_input, missing_config, blocked,
// stale, conflict, unavailable. Messages never include secrets or personal text.

export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "invalid_input"
  | "missing_config"
  | "blocked"
  | "stale"
  | "conflict"
  | "unavailable";

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  invalid_input: 400,
  missing_config: 503,
  blocked: 422,
  stale: 409,
  conflict: 409,
  unavailable: 503,
};

export function corsHeaders(allowedOrigin: string | undefined): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin && allowedOrigin.trim().length > 0 ? allowedOrigin.trim() : "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

export function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export function errorResponse(code: ErrorCode, message: string, cors: Record<string, string>, extra: Record<string, unknown> = {}): Response {
  return json({ error: { code, message, ...extra } }, STATUS[code], cors);
}

export class HttpError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
