/**
 * Server-side session store for the operations console (Model A — "act as the
 * signed-in user"). Each ops session holds the operator's own ArcGIS access token
 * (and refresh token) so that data reads/writes run under *their* portal identity:
 * the portal then enforces layer sharing, editing privileges and ownership-based
 * access control for free. The ops session cookie carries only a random `sid`
 * (signed into the JWT) — never the ArcGIS tokens themselves.
 *
 * The store is in-memory (module scope), mirroring the admin-token cache in
 * arcgis.ts. A backend restart drops every session, which simply forces operators
 * to sign in again; for a multi-instance deployment swap this for a shared store
 * (Redis / DB) keyed by the same `sid`.
 */
import crypto from "crypto";
import { refreshAccessToken } from "@/lib/ops-oauth";

interface OpsSession {
  username: string;
  accessToken: string;
  /** Epoch ms when the access token expires. */
  accessExpires: number;
  refreshToken?: string;
}

const sessions = new Map<string, OpsSession>();

/** Store a freshly-authenticated session and return its opaque session id. */
export function createOpsSession(s: OpsSession): string {
  const sid = crypto.randomBytes(18).toString("hex");
  sessions.set(sid, s);
  return sid;
}

export function hasOpsSession(sid: string): boolean {
  return sessions.has(sid);
}

export function destroyOpsSession(sid: string): void {
  sessions.delete(sid);
}

/**
 * Return a valid ArcGIS access token for the session, refreshing it (via the
 * stored refresh token) when it is within 5 minutes of expiry. Throws if the
 * session is gone or cannot be refreshed — callers map that to a 401 so the
 * operator re-authenticates.
 */
export async function getUserToken(sid: string): Promise<string> {
  const s = sessions.get(sid);
  if (!s) throw new Error("ops session not found");

  const now = Date.now();
  if (s.accessExpires - 5 * 60_000 > now) return s.accessToken;

  if (!s.refreshToken) throw new Error("ops session expired (no refresh token)");
  const r = await refreshAccessToken(s.refreshToken);
  s.accessToken = r.access_token;
  s.accessExpires = now + (r.expires_in || 0) * 1000;
  return s.accessToken;
}
