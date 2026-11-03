/**
 * Access to the PRIVATE single-row **Water_Organization** table, which now holds
 * ALL organization details managed from the operations-console Organization page:
 *
 *   • profile          — org name + logo
 *   • support contacts — email + up to four support phone lines + WhatsApp link
 *   • M-Pesa (Daraja)  — env, txn type, shortcode, callback + SECRET key/secret/passkey
 *   • SMS (AT)         — username, sender id + SECRET api key
 *   • Email (SMTP)     — host/port/secure/user/from + SECRET password
 *
 * The table is owner-only: it is read/written here with the admin token and NEVER
 * exposed to the browser. The API returns only a masked ("configured") view of the
 * secret fields; non-secret profile/contact fields are returned in full. The
 * customer app's /api/support reads the contact fields via getSupportContacts().
 *
 * Saved values override the env defaults in config.ts; the `getEffective*` helpers
 * do that merge so the live payment / SMS / email paths pick up changes without a
 * redeploy. A short in-process cache keeps the hot payment path from re-querying
 * the table on every call.
 *
 * (This consolidates the retired Water_OrgSettings + Water_OrgSettings_Secure pair.)
 */
import { config } from "@/lib/config";
import {
  queryLayer,
  applyEdits,
  insertOne,
  listAttachments,
  addAttachment,
  deleteAttachments,
  fetchAttachment,
} from "@/lib/arcgis";

interface OrgRow {
  objectid: number;
  // profile
  org_name: string | null;
  logo: string | null;
  // support contacts — up to four support phone lines + a WhatsApp link
  contact_email: string | null;
  contact_phone: string | null;
  contact_phone_2: string | null;
  contact_phone_3: string | null;
  contact_phone_4: string | null;
  whatsapp: string | null;
  // SMS (Africa's Talking)
  sms_username: string | null;
  sms_api_key: string | null;
  sms_sender_id: string | null;
  // SMTP email
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: string | null; // "Yes" | "No"
  smtp_user: string | null;
  smtp_pass: string | null;
  smtp_from: string | null;
  // M-Pesa (Daraja)
  mpesa_env: string | null;
  mpesa_consumer_key: string | null;
  mpesa_consumer_secret: string | null;
  mpesa_shortcode: string | null;
  mpesa_passkey: string | null;
  mpesa_callback_url: string | null;
  mpesa_txn_type: string | null;
}

let cache: { row: OrgRow | null; expires: number } | null = null;
const CACHE_MS = 30_000;
const str = (v: unknown): string => (v == null ? "" : String(v)).trim();
const isYes = (v: unknown, dflt = false): boolean => (v == null ? dflt : /^yes$/i.test(str(v)));

/** Read the single org row (cached ~30s). Returns null if the table is empty. */
async function getRow(force = false): Promise<OrgRow | null> {
  const now = Date.now();
  if (!force && cache && cache.expires > now) return cache.row;
  const rows = await queryLayer<OrgRow>(config.layers.organization, {
    where: "1=1",
    outFields: "*",
    orderByFields: "objectid",
    resultRecordCount: 1,
  });
  cache = { row: rows[0] || null, expires: now + CACHE_MS };
  return cache.row;
}

/** Invalidate the cache after a write. */
function bust() {
  cache = null;
}

async function upsert(attrs: Record<string, unknown>): Promise<void> {
  if (Object.keys(attrs).length === 0) return;
  const existing = await getRow(true);
  if (existing) {
    await applyEdits(config.layers.organization, { updates: [{ attributes: { objectid: existing.objectid, ...attrs } }] });
  } else {
    await insertOne(config.layers.organization, attrs);
  }
  bust();
}

// ---- Full organization view (GET /api/ops/organization) ---------------------
// Non-secret fields are returned in full; secrets are reported only as `*Set` flags.
export async function getOrganization() {
  const r = (await getRow()) || ({} as Partial<OrgRow>);
  return {
    profile: {
      org_name: str(r.org_name),
      contact_email: str(r.contact_email),
      contact_phone: str(r.contact_phone),
      contact_phone_2: str(r.contact_phone_2),
      contact_phone_3: str(r.contact_phone_3),
      contact_phone_4: str(r.contact_phone_4),
      whatsapp: str(r.whatsapp),
    },
    mpesa: {
      env: str(r.mpesa_env) || config.mpesa.env,
      txnType: str(r.mpesa_txn_type) || config.mpesa.transactionType,
      shortcode: str(r.mpesa_shortcode) || config.mpesa.shortcode,
      callbackUrl: str(r.mpesa_callback_url) || config.mpesa.callbackUrl,
      passkeySet: !!str(r.mpesa_passkey) || !!config.mpesa.passkey,
      consumerKeySet: !!str(r.mpesa_consumer_key) || !!config.mpesa.consumerKey,
      consumerSecretSet: !!str(r.mpesa_consumer_secret) || !!config.mpesa.consumerSecret,
    },
    sms: {
      username: str(r.sms_username) || config.sms.username,
      senderId: str(r.sms_sender_id) || config.sms.senderId,
      apiKeySet: !!str(r.sms_api_key) || !!config.sms.apiKey,
    },
    smtp: {
      host: str(r.smtp_host) || config.smtp.host,
      port: r.smtp_port != null ? r.smtp_port : config.smtp.port,
      secure: r.smtp_secure != null ? isYes(r.smtp_secure) : config.smtp.secure,
      user: str(r.smtp_user) || config.smtp.user,
      from: str(r.smtp_from) || config.smtp.from,
      passSet: !!str(r.smtp_pass) || !!config.smtp.pass,
    },
  };
}

/**
 * Customer-facing support contacts (GET /api/support). Read from the same org row
 * with the admin token; returns only the non-secret contact fields the customer
 * app shows — organization name, support phone lines, WhatsApp link, email and the
 * M-Pesa Pay Bill shortcode.
 */
export async function getSupportContacts() {
  const r = (await getRow()) || ({} as Partial<OrgRow>);
  const phones = [r.contact_phone, r.contact_phone_2, r.contact_phone_3, r.contact_phone_4]
    .map((p) => str(p))
    .filter(Boolean);
  return {
    utility: str(r.org_name),
    phones,
    whatsapp: str(r.whatsapp),
    email: str(r.contact_email),
    payBill: str(r.mpesa_shortcode) || config.mpesa.shortcode,
  };
}

export interface OrgPatch {
  profile?: Partial<{
    org_name: string; contact_email: string;
    contact_phone: string; contact_phone_2: string; contact_phone_3: string; contact_phone_4: string;
    whatsapp: string;
  }>;
  mpesa?: SettingsPatch["mpesa"];
  sms?: SettingsPatch["sms"];
  smtp?: SettingsPatch["smtp"];
}

/** Upsert the single org row. Blank secret fields keep the stored value. */
export async function updateOrganization(patch: OrgPatch): Promise<void> {
  const attrs: Record<string, unknown> = {};

  if (patch.profile) {
    const p = patch.profile;
    const setStr = (field: keyof OrgRow, v: string | undefined) => { if (v !== undefined) attrs[field] = v || null; };
    setStr("org_name", p.org_name);
    setStr("contact_email", p.contact_email);
    setStr("contact_phone", p.contact_phone);
    setStr("contact_phone_2", p.contact_phone_2);
    setStr("contact_phone_3", p.contact_phone_3);
    setStr("contact_phone_4", p.contact_phone_4);
    setStr("whatsapp", p.whatsapp);
  }

  applyCommsPatch(attrs, patch);

  await upsert(attrs);
}

// ---- Organization logo (stored as a record ATTACHMENT) ----------------------
// The logo is kept as a binary attachment on the single org row — NOT inline in
// a feature field — so real-size images (PNG/JPEG/SVG up to a couple of MB) are
// supported without overflowing the string column. Read/written here with the
// admin token; the API serves the bytes back as a data URL to the console.

/** The single org row's OBJECTID, creating an empty row first if none exists. */
async function ensureRowId(): Promise<number> {
  const existing = await getRow(true);
  if (existing) return existing.objectid;
  const oid = await insertOne(config.layers.organization, {});
  bust();
  return oid;
}

/** Replace the org logo with `data` (one attachment at a time). */
export async function setOrgLogo(data: Buffer, filename: string, contentType: string): Promise<void> {
  const oid = await ensureRowId();
  const existing = await listAttachments(config.layers.organization, oid);
  await deleteAttachments(config.layers.organization, oid, existing.map((a) => a.id));
  await addAttachment(config.layers.organization, oid, data, filename, contentType);
  // Drop any legacy base64 that may still sit in the `logo` text column.
  await applyEdits(config.layers.organization, { updates: [{ attributes: { objectid: oid, logo: null } }] });
  bust();
}

/** The org logo bytes, or null if none is attached. */
export async function getOrgLogo(): Promise<{ data: Buffer; contentType: string } | null> {
  const row = await getRow();
  if (!row) return null;
  const existing = await listAttachments(config.layers.organization, row.objectid);
  if (!existing.length) return null;
  // The most recently added attachment is the current logo.
  const latest = existing[existing.length - 1];
  return fetchAttachment(config.layers.organization, row.objectid, latest.id);
}

/** Remove the org logo attachment(s). No-op when there is none. */
export async function deleteOrgLogo(): Promise<void> {
  const row = await getRow(true);
  if (!row) return;
  const existing = await listAttachments(config.layers.organization, row.objectid);
  await deleteAttachments(config.layers.organization, row.objectid, existing.map((a) => a.id));
}

// ---- Masked comms view (legacy GET /api/ops/settings + /api/admin/settings) --
export async function getMaskedSettings() {
  const org = await getOrganization();
  return { sms: org.sms, smtp: org.smtp, mpesa: org.mpesa };
}

// ---- Comms updates -----------------------------------------------------------
// Each group is optional; within a group a `null`/`undefined` SECRET field means
// "keep the stored value" (so a blank password box never wipes the saved secret).
export interface SettingsPatch {
  sms?: { username?: string; senderId?: string; apiKey?: string | null };
  smtp?: { host?: string; port?: number | null; secure?: boolean; user?: string; from?: string; pass?: string | null };
  mpesa?: {
    env?: string;
    txnType?: string;
    shortcode?: string;
    callbackUrl?: string;
    passkey?: string | null;
    consumerKey?: string | null;
    consumerSecret?: string | null;
  };
}

/** Shared comms (SMS/SMTP/M-Pesa) → attrs mapping used by both update paths. */
function applyCommsPatch(attrs: Record<string, unknown>, patch: SettingsPatch): void {
  const setSecret = (field: string, v: string | null | undefined) => {
    // Only overwrite a secret when a non-empty value is provided.
    if (v != null && String(v).length > 0) attrs[field] = v;
  };

  if (patch.sms) {
    if (patch.sms.username !== undefined) attrs.sms_username = patch.sms.username || null;
    if (patch.sms.senderId !== undefined) attrs.sms_sender_id = patch.sms.senderId || null;
    setSecret("sms_api_key", patch.sms.apiKey);
  }
  if (patch.smtp) {
    if (patch.smtp.host !== undefined) attrs.smtp_host = patch.smtp.host || null;
    if (patch.smtp.port !== undefined) attrs.smtp_port = patch.smtp.port ?? null;
    if (patch.smtp.secure !== undefined) attrs.smtp_secure = patch.smtp.secure ? "Yes" : "No";
    if (patch.smtp.user !== undefined) attrs.smtp_user = patch.smtp.user || null;
    if (patch.smtp.from !== undefined) attrs.smtp_from = patch.smtp.from || null;
    setSecret("smtp_pass", patch.smtp.pass);
  }
  if (patch.mpesa) {
    if (patch.mpesa.env !== undefined) attrs.mpesa_env = patch.mpesa.env || null;
    if (patch.mpesa.txnType !== undefined) attrs.mpesa_txn_type = patch.mpesa.txnType || null;
    if (patch.mpesa.shortcode !== undefined) attrs.mpesa_shortcode = patch.mpesa.shortcode || null;
    if (patch.mpesa.callbackUrl !== undefined) attrs.mpesa_callback_url = patch.mpesa.callbackUrl || null;
    setSecret("mpesa_passkey", patch.mpesa.passkey);
    setSecret("mpesa_consumer_key", patch.mpesa.consumerKey);
    setSecret("mpesa_consumer_secret", patch.mpesa.consumerSecret);
  }
}

export async function updateSettings(patch: SettingsPatch): Promise<void> {
  const attrs: Record<string, unknown> = {};
  applyCommsPatch(attrs, patch);
  await upsert(attrs);
}

// ---- Effective config (stored value, else env default) ----------------------
export async function getEffectiveMpesa() {
  const r = (await getRow()) || ({} as Partial<OrgRow>);
  return {
    env: (str(r.mpesa_env) || config.mpesa.env).toLowerCase(),
    consumerKey: str(r.mpesa_consumer_key) || config.mpesa.consumerKey,
    consumerSecret: str(r.mpesa_consumer_secret) || config.mpesa.consumerSecret,
    shortcode: str(r.mpesa_shortcode) || config.mpesa.shortcode,
    passkey: str(r.mpesa_passkey) || config.mpesa.passkey,
    callbackUrl: str(r.mpesa_callback_url) || config.mpesa.callbackUrl,
    transactionType: str(r.mpesa_txn_type) || config.mpesa.transactionType,
  };
}

export async function getEffectiveSms() {
  const r = (await getRow()) || ({} as Partial<OrgRow>);
  return {
    username: str(r.sms_username) || config.sms.username,
    apiKey: str(r.sms_api_key) || config.sms.apiKey,
    senderId: str(r.sms_sender_id) || config.sms.senderId,
  };
}

export async function getEffectiveSmtp() {
  const r = (await getRow()) || ({} as Partial<OrgRow>);
  const port = r.smtp_port != null ? r.smtp_port : config.smtp.port;
  return {
    host: str(r.smtp_host) || config.smtp.host,
    port,
    secure: r.smtp_secure != null ? isYes(r.smtp_secure) : config.smtp.secure,
    user: str(r.smtp_user) || config.smtp.user,
    pass: str(r.smtp_pass) || config.smtp.pass,
    from: str(r.smtp_from) || config.smtp.from,
  };
}
