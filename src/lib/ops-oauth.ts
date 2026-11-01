/**
 * ArcGIS Enterprise OAuth 2.0 (authorization-code flow) for the operations console.
 *
 * The browser is redirected to the portal's own sign-in/consent screen; on success
 * the portal redirects back to our callback with a `code`, which we exchange for an
 * access token *server-side* using the registered app's client secret. We then read
 * the signed-in user's profile and mint an ops session (see jwt.ts / http.ts).
 *
 * All secrets stay on the server — the browser never sees the client secret, the
 * ArcGIS access token, or the raw code exchange.
 */
import { config } from "@/lib/config";

const OAUTH_BASE = `${config.portal}/sharing/rest/oauth2`;

/** Build the portal authorize URL the browser is redirected to. */
export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.ops.clientId,
    response_type: "code",
    redirect_uri: config.ops.redirectUri,
    state,
    // Token lifetime in minutes (max 20160 = 14 days on most portals).
    expiration: "20160",
  });
  return `${OAUTH_BASE}/authorize?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  username: string;
  refresh_token?: string;
}

/** Exchange an authorization code for an access token. Throws on any ArcGIS error. */
export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch(`${OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      f: "json",
      client_id: config.ops.clientId,
      client_secret: config.ops.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.ops.redirectUri,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!json || json.error) {
    const msg = json?.error?.error_description || json?.error?.message || `HTTP ${res.status}`;
    throw new Error(`OAuth token exchange failed: ${msg}`);
  }
  if (!json.access_token || !json.username) {
    throw new Error("OAuth token exchange returned no token");
  }
  return json as TokenResponse;
}

/** Exchange a refresh token for a fresh access token (ArcGIS keeps the same
 *  refresh token valid, so only the access token comes back). Throws on error. */
export async function refreshAccessToken(
  refreshToken: string
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(`${OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      f: "json",
      client_id: config.ops.clientId,
      client_secret: config.ops.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!json || json.error || !json.access_token) {
    const msg = json?.error?.error_description || json?.error?.message || `HTTP ${res.status}`;
    throw new Error(`OAuth token refresh failed: ${msg}`);
  }
  return { access_token: json.access_token, expires_in: Number(json.expires_in) || 0 };
}

export interface SelfInfo {
  username: string;
  fullName: string;
  /** Portal role name, e.g. "org_admin", "org_publisher", "org_user", or a custom role name. */
  role: string;
  roleId?: string;
  groups: Array<{ id: string; title: string }>;
  privileges: string[];
}

/** Read the signed-in user's portal profile (identity + role + group membership). */
export async function fetchSelf(token: string): Promise<SelfInfo> {
  const url = `${config.portal}/sharing/rest/community/self?f=json&token=${encodeURIComponent(token)}`;
  const json = await (await fetch(url)).json().catch(() => null);
  if (!json || json.error || !json.username) {
    throw new Error(`community/self failed: ${JSON.stringify(json?.error || json || "no response")}`);
  }
  return {
    username: json.username,
    fullName: (typeof json.fullName === "string" && json.fullName) || json.username,
    role: json.role || "",
    roleId: json.roleId,
    groups: Array.isArray(json.groups)
      ? json.groups.map((g: any) => ({ id: g.id, title: g.title }))
      : [],
    privileges: Array.isArray(json.privileges) ? json.privileges : [],
  };
}

/**
 * Entry gate (Decision 1): is this portal member allowed into the ops console?
 * Access is administered in the portal by membership of a configured group
 * (by id, preferred, or title). If neither OPS_REQUIRED_GROUP_ID nor
 * OPS_REQUIRED_GROUP is set, every authenticated portal user is allowed in
 * (dev fallback) — a warning is logged once so this isn't silently permissive.
 */
let warnedNoGroup = false;
export function isOpsMember(self: SelfInfo): boolean {
  const { requiredGroupId, requiredGroup } = config.ops;
  if (!requiredGroupId && !requiredGroup) {
    if (!warnedNoGroup) {
      console.warn(
        "[ops] No OPS_REQUIRED_GROUP_ID / OPS_REQUIRED_GROUP set — every authenticated portal user can sign in."
      );
      warnedNoGroup = true;
    }
    return true;
  }
  return self.groups.some(
    (g) => (requiredGroupId && g.id === requiredGroupId) || (requiredGroup && g.title === requiredGroup)
  );
}
