/**
 * Shared HTTP plumbing for API routes: CORS, method guards, JSON-auth extraction
 * and a uniform error-handling wrapper. Keeps each route handler small and
 * focused on business logic.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { config } from "@/lib/config";
import { verifySession, verifyAdmin, verifyOps, type CustomerClaims, type AdminClaims, type OpsClaims } from "@/lib/jwt";
import { getUserToken } from "@/lib/ops-sessions";
import { ArcgisError } from "@/lib/arcgis";

/** Apply CORS headers. Returns true if the request was a preflight (already ended). */
export function applyCors(req: NextApiRequest, res: NextApiResponse): boolean {
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else if (config.allowedOrigins.length) {
    res.setHeader("Access-Control-Allow-Origin", config.allowedOrigins[0]);
  }
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Handler = (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void;

/** Wrap a handler with CORS + top-level error handling. */
export function withApi(handler: Handler): Handler {
  return async (req, res) => {
    if (applyCors(req, res)) return;
    try {
      await handler(req, res);
    } catch (err: any) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error(`[api] ${req.method} ${req.url}:`, err);
      res.status(status).json({ error: err?.message || "Internal error" });
    }
  };
}

/** Throw unless the request method is one of the allowed ones. */
export function requireMethod(req: NextApiRequest, ...methods: string[]) {
  if (!methods.includes(req.method || "")) {
    throw new HttpError(405, `Method ${req.method} not allowed`);
  }
}

/** Verify the Bearer token and return the customer's claims, or 401. */
export function requireAuth(req: NextApiRequest): CustomerClaims {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new HttpError(401, "Missing or malformed Authorization header");
  }
  try {
    return verifySession(token);
  } catch {
    throw new HttpError(401, "Invalid or expired session");
  }
}

/** Verify the Bearer token is a valid ADMIN session, or 401. */
export function requireAdmin(req: NextApiRequest): AdminClaims {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new HttpError(401, "Missing or malformed Authorization header");
  }
  try {
    return verifyAdmin(token);
  } catch {
    throw new HttpError(401, "Invalid or expired admin session");
  }
}

// ---- Operations-console session (httpOnly cookie) ---------------------------
// The ops console authenticates via ArcGIS OAuth (see api/ops/oauth/*). The
// resulting session is stored in an httpOnly cookie rather than a Bearer header,
// so the browser attaches it automatically on `credentials: "include"` fetches.
export const OPS_COOKIE = "ops_session";
const OPS_MAX_AGE = 7 * 24 * 60 * 60; // 7 days, in seconds

/** Append one Set-Cookie entry without clobbering others already queued. */
function appendCookie(res: NextApiResponse, cookie: string) {
  const prev = res.getHeader("Set-Cookie");
  const list = Array.isArray(prev) ? prev : prev ? [String(prev)] : [];
  list.push(cookie);
  res.setHeader("Set-Cookie", list);
}

/** Set the ops session cookie. SameSite=Lax is fine: :3100 → :4000 is same-site. */
export function setOpsCookie(res: NextApiResponse, token: string) {
  appendCookie(res, `${OPS_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${OPS_MAX_AGE}`);
}

/** Clear the ops session cookie (sign-out). */
export function clearOpsCookie(res: NextApiResponse) {
  appendCookie(res, `${OPS_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

/** Set a short-lived helper cookie (e.g. the OAuth `state`). Pass maxAgeSec=0 to clear. */
export function setTempCookie(res: NextApiResponse, name: string, value: string, maxAgeSec = 600) {
  appendCookie(res, `${name}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSec}`);
}

/** Verify the ops session cookie and return its claims, or 401. */
export function requireOps(req: NextApiRequest): OpsClaims {
  const token = req.cookies?.[OPS_COOKIE];
  if (!token) throw new HttpError(401, "Not signed in");
  try {
    return verifyOps(token);
  } catch {
    throw new HttpError(401, "Invalid or expired session");
  }
}

/**
 * Resolve the signed-in operator's own ArcGIS token (Model A). Portal-governed
 * data ops run under this token so the portal's sharing/editing permissions apply.
 * Throws 401 if the session is gone or can't be refreshed — the console then sends
 * the operator back to sign in.
 */
export async function getOpsUserToken(req: NextApiRequest): Promise<string> {
  const claims = requireOps(req);
  if (!claims.sid) throw new HttpError(401, "Your session needs to be renewed. Please sign in again.");
  try {
    return await getUserToken(claims.sid);
  } catch {
    throw new HttpError(401, "Your session expired. Please sign in again.");
  }
}

/**
 * Translate an error from a user-token ArcGIS call into an HTTP error. A portal
 * permission denial (ArcGIS code 403) becomes a 403 the operator can act on; token
 * problems (498/499) become a 401 re-auth. Everything else bubbles up as-is.
 */
export function mapOpsDataError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof ArcgisError) {
    if (err.code === 403) return new HttpError(403, "Your portal account isn't permitted to perform this action.");
    if (err.code === 498 || err.code === 499) return new HttpError(401, "Your session expired. Please sign in again.");
  }
  return new HttpError(500, err instanceof Error ? err.message : "Internal error");
}
