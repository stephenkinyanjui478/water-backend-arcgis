/**
 * Thin ArcGIS Enterprise REST client used by every API route.
 *
 * It caches an admin token (generateToken with the owner creds) in module scope
 * and refreshes it before expiry, so the private Water_CustomerAuth /
 * Water_MpesaTransactions tables (owner-only) can be read and written server-side.
 * Public Water_* layers are also edited with this admin token for data integrity,
 * never anonymously from the browser.
 *
 * ArcGIS returns HTTP 200 even on logical errors ({"error": {...}}), so every
 * response body is checked.
 */
import { config } from "@/lib/config";

let cachedToken: { token: string; expires: number } | null = null;

/** An error returned by ArcGIS REST, carrying its logical error `code` (e.g. 403
 *  permission denied, 498/499 token problems) so callers can map it to HTTP. */
export class ArcgisError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
    this.name = "ArcgisError";
  }
}

/**
 * Retry a fetch-based call on a transient *connection* failure only. On a
 * long-running server, undici pools keep-alive sockets; ArcGIS Enterprise (IIS)
 * drops idle ones, so the next reused socket can fail pre-send with a bare
 * `TypeError: fetch failed`. Those are safe to retry. A response we actually
 * received — an ArcGIS logical error (ArcgisError) or a non-JSON body — is thrown
 * from inside `fn` as a non-TypeError and must never be retried.
 */
async function withNetRetry<T>(fn: () => Promise<T>, attempts: number): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof TypeError)) throw e; // real response/logic error — don't retry
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
  const cause = (lastErr as any)?.cause;
  throw new Error(`Network error reaching ArcGIS: ${cause?.code || cause?.message || (lastErr as Error)?.message}`);
}

/**
 * POST form-encoded params to an ArcGIS endpoint and return the parsed JSON.
 * `attempts` bounds the connection-failure retries (see withNetRetry); pass 1 for
 * non-idempotent writes (inserts) where a retry could duplicate a record.
 */
async function postForm(url: string, params: Record<string, string>, attempts = 3): Promise<any> {
  return withNetRetry(async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: config.arcgis.referer },
      body: new URLSearchParams(params),
    });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON from ${url} (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
    if (json && json.error) {
      throw new ArcgisError(`ArcGIS error from ${url}: ${JSON.stringify(json.error)}`, Number(json.error.code) || undefined);
    }
    return json;
  }, attempts);
}

/** Get a valid admin token, refreshing ~5 min before it expires. */
export async function getAdminToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expires - 5 * 60_000 > now) {
    return cachedToken.token;
  }
  const json = await postForm(`${config.portal}/sharing/rest/generateToken`, {
    username: config.arcgis.user,
    password: config.arcgis.password,
    referer: config.arcgis.referer,
    f: "json",
    expiration: "60",
  });
  if (!json.token) throw new Error(`generateToken failed: ${JSON.stringify(json)}`);
  cachedToken = { token: json.token, expires: json.expires || now + 60 * 60_000 };
  return cachedToken.token;
}

export interface QueryOptions {
  where?: string;
  outFields?: string;
  orderByFields?: string;
  returnGeometry?: boolean;
  resultRecordCount?: number;
  resultOffset?: number;
  groupByFieldsForStatistics?: string;
  outStatistics?: unknown;
}

/**
 * Query a layer/table and return the raw feature attribute objects. Pass `asToken`
 * to run the query under a specific identity (the ops console passes the signed-in
 * operator's token so portal access control applies); omit it to use the admin token.
 */
export async function queryLayer<T = Record<string, any>>(
  layerUrl: string,
  opts: QueryOptions = {},
  asToken?: string
): Promise<T[]> {
  const token = asToken || (await getAdminToken());
  const params: Record<string, string> = {
    f: "json",
    token,
    where: opts.where || "1=1",
    outFields: opts.outFields || "*",
    returnGeometry: String(opts.returnGeometry ?? false),
  };
  if (opts.orderByFields) params.orderByFields = opts.orderByFields;
  if (opts.resultRecordCount) params.resultRecordCount = String(opts.resultRecordCount);
  if (opts.resultOffset != null) params.resultOffset = String(opts.resultOffset);
  if (opts.groupByFieldsForStatistics) params.groupByFieldsForStatistics = opts.groupByFieldsForStatistics;
  if (opts.outStatistics) params.outStatistics = JSON.stringify(opts.outStatistics);
  const json = await postForm(`${layerUrl}/query`, params);
  return (json.features || []).map((f: any) => f.attributes as T);
}

/** Count matching rows without pulling them. `asToken` runs it as that identity. */
export async function countLayer(layerUrl: string, where = "1=1", asToken?: string): Promise<number> {
  const token = asToken || (await getAdminToken());
  const json = await postForm(`${layerUrl}/query`, {
    f: "json",
    token,
    where,
    returnCountOnly: "true",
  });
  return json.count || 0;
}

export interface ApplyEditsResult {
  addResults?: Array<{ objectId: number; success: boolean; error?: unknown }>;
  updateResults?: Array<{ objectId: number; success: boolean; error?: unknown }>;
  deleteResults?: Array<{ objectId: number; success: boolean; error?: unknown }>;
}

/** applyEdits (optionally as a given identity via `asToken`; defaults to admin).
 *  Features may carry an optional point `geometry`. */
export async function applyEdits(
  layerUrl: string,
  edits: {
    adds?: Array<{ attributes: Record<string, any>; geometry?: Record<string, any> }>;
    updates?: Array<{ attributes: Record<string, any>; geometry?: Record<string, any> }>;
    deletes?: number[];
  },
  asToken?: string
): Promise<ApplyEditsResult> {
  const token = asToken || (await getAdminToken());
  const params: Record<string, string> = { f: "json", token, rollbackOnFailure: "true" };
  if (edits.adds) params.adds = JSON.stringify(edits.adds);
  if (edits.updates) params.updates = JSON.stringify(edits.updates);
  if (edits.deletes) params.deletes = JSON.stringify(edits.deletes);
  // Updates/deletes are idempotent (keyed by OBJECTID) so may retry a dropped
  // socket; an insert must not, since a pre-send retry could duplicate the row.
  const attempts = edits.adds?.length ? 1 : 3;
  const json = await postForm(`${layerUrl}/applyEdits`, params, attempts);

  // Surface per-feature failures that applyEdits reports without a top-level error.
  const fail = [...(json.addResults || []), ...(json.updateResults || []), ...(json.deleteResults || [])].find(
    (r: any) => r && r.success === false
  );
  if (fail) throw new Error(`applyEdits failed: ${JSON.stringify(fail.error || fail)}`);
  return json as ApplyEditsResult;
}

/** Insert one row (optionally with a point geometry) and return its new OBJECTID. */
export async function insertOne(
  layerUrl: string,
  attributes: Record<string, any>,
  geometry?: Record<string, any>,
  asToken?: string
): Promise<number> {
  const add = geometry ? { attributes, geometry } : { attributes };
  const res = await applyEdits(layerUrl, { adds: [add] }, asToken);
  const oid = res.addResults?.[0]?.objectId;
  if (oid == null) throw new Error("insert returned no objectId");
  return oid;
}

/** Escape a string for safe interpolation into an ArcGIS SQL `where` clause. */
export function sqlEscape(value: string): string {
  return value.replace(/'/g, "''");
}

// ---- Attachments ------------------------------------------------------------
// Used for the customer's profile photo, stored as an attachment on their
// Water_CustomerAuth row. The table is private, so attachments are only ever
// read/written server-side with the admin token (never exposed to the browser).

export interface AttachmentInfo {
  id: number;
  name: string;
  contentType: string;
  size: number;
}

/** List attachment metadata for a feature. */
export async function listAttachments(layerUrl: string, oid: number): Promise<AttachmentInfo[]> {
  const token = await getAdminToken();
  const json = await postForm(`${layerUrl}/${oid}/attachments`, { f: "json", token });
  return (json.attachmentInfos || []).map((a: any) => ({
    id: a.id,
    name: a.name,
    contentType: a.contentType,
    size: a.size,
  }));
}

/**
 * Attachment metadata for many features in one call, keyed by parent OBJECTID.
 * Pass `oids` to scope the query, or omit it to list every attachment on the
 * layer (used to flag which rows have a document). Features with no attachment
 * are simply absent from the returned map.
 */
export async function queryAttachments(
  layerUrl: string,
  oids?: number[]
): Promise<Record<number, AttachmentInfo[]>> {
  if (oids && !oids.length) return {};
  const token = await getAdminToken();
  const json = await postForm(`${layerUrl}/queryAttachments`, {
    f: "json",
    token,
    ...(oids ? { objectIds: oids.join(",") } : { definitionExpression: "1=1" }),
  });
  const out: Record<number, AttachmentInfo[]> = {};
  for (const g of json.attachmentGroups || []) {
    out[g.parentObjectId] = (g.attachmentInfos || []).map((a: any) => ({
      id: a.id,
      name: a.name,
      contentType: a.contentType,
      size: a.size,
    }));
  }
  return out;
}

/** Attach a binary file to a feature. Returns the new attachment id. */
export async function addAttachment(
  layerUrl: string,
  oid: number,
  data: Buffer,
  filename: string,
  contentType: string
): Promise<number> {
  const token = await getAdminToken();
  const form = new FormData();
  form.append("f", "json");
  form.append("token", token);
  form.append("attachment", new Blob([new Uint8Array(data)], { type: contentType }), filename);
  const res = await fetch(`${layerUrl}/${oid}/addAttachment`, {
    method: "POST",
    headers: { Referer: config.arcgis.referer },
    body: form,
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON from addAttachment (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (json.error) throw new Error(`addAttachment error: ${JSON.stringify(json.error)}`);
  const result = json.addAttachmentResult;
  if (!result || result.success === false || result.objectId == null) {
    throw new Error(`addAttachment failed: ${JSON.stringify(json)}`);
  }
  return result.objectId;
}

/** Delete attachments from a feature. No-op for an empty id list. */
export async function deleteAttachments(layerUrl: string, oid: number, ids: number[]): Promise<void> {
  if (!ids.length) return;
  const token = await getAdminToken();
  await postForm(`${layerUrl}/${oid}/deleteAttachments`, {
    f: "json",
    token,
    attachmentIds: ids.join(","),
  });
}

/** Fetch an attachment's raw bytes and content type. */
export async function fetchAttachment(
  layerUrl: string,
  oid: number,
  attachmentId: number
): Promise<{ data: Buffer; contentType: string }> {
  const token = await getAdminToken();
  const res = await fetch(`${layerUrl}/${oid}/attachments/${attachmentId}?token=${encodeURIComponent(token)}`, {
    headers: { Referer: config.arcgis.referer },
  });
  if (!res.ok) throw new Error(`fetchAttachment HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const data = Buffer.from(await res.arrayBuffer());
  return { data, contentType };
}
