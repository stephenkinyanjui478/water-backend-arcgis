/**
 * Access to the PRIVATE Water_OrgSettings_Secure single-row table, which holds the
 * SECRET communication credentials (Africastalking SMS, SMTP email, M-Pesa Daraja)
 * managed from the admin client's Organization page.
 *
 * The table is owner-only: it is read/written here with the admin token and NEVER
 * exposed to the browser. The admin API returns only a masked ("configured") view.
 *
 * Saved values override the env defaults in config.ts; the `getEffective*` helpers
 * do that merge so the live payment / SMS / email paths pick up changes without a
 * redeploy. A short in-process cache keeps the hot payment path from re-querying
 * the table on every call.
 */
import { config } from "@/lib/config";
import { queryLayer, applyEdits, insertOne } from "@/lib/arcgis";

interface SecureRow {
  objectid: number;
  sms_username: string | null;
  sms_api_key: string | null;
  sms_sender_id: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: string | null; // "Yes" | "No"
  smtp_user: string | null;
  smtp_pass: string | null;
  smtp_from: string | null;
  mpesa_env: string | null;
  mpesa_consumer_key: string | null;
  mpesa_consumer_secret: string | null;
  mpesa_shortcode: string | null;
  mpesa_passkey: string | null;
  mpesa_callback_url: string | null;
  mpesa_txn_type: string | null;
}

let cache: { row: SecureRow | null; expires: number } | null = null;
const CACHE_MS = 30_000;
const str = (v: unknown): string => (v == null ? "" : String(v)).trim();

/** Read the single secure row (cached ~30s). Returns null if the table is empty. */
async function getRow(force = false): Promise<SecureRow | null> {
  const now = Date.now();
  if (!force && cache && cache.expires > now) return cache.row;
  const rows = await queryLayer<SecureRow>(config.layers.orgSettingsSecure, {
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

// ---- Masked view for GET /api/admin/settings --------------------------------
export async function getMaskedSettings() {
  const r = (await getRow()) || ({} as Partial<SecureRow>);
  return {
    sms: {
      username: str(r.sms_username),
      senderId: str(r.sms_sender_id),
      apiKeySet: !!str(r.sms_api_key) || !!config.sms.apiKey,
    },
    smtp: {
      host: str(r.smtp_host) || config.smtp.host,
      port: r.smtp_port != null ? r.smtp_port : config.smtp.port,
      secure: r.smtp_secure != null ? /^yes$/i.test(str(r.smtp_secure)) : config.smtp.secure,
      user: str(r.smtp_user) || config.smtp.user,
      from: str(r.smtp_from) || config.smtp.from,
      passSet: !!str(r.smtp_pass) || !!config.smtp.pass,
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
  };
}

// ---- Updates from PUT /api/admin/settings -----------------------------------
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

export async function updateSettings(patch: SettingsPatch): Promise<void> {
  const attrs: Record<string, unknown> = {};
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

  if (Object.keys(attrs).length === 0) return;

  const existing = await getRow(true);
  if (existing) {
    await applyEdits(config.layers.orgSettingsSecure, { updates: [{ attributes: { objectid: existing.objectid, ...attrs } }] });
  } else {
    await insertOne(config.layers.orgSettingsSecure, attrs);
  }
  bust();
}

// ---- Effective config (stored value, else env default) ----------------------
export async function getEffectiveMpesa() {
  const r = (await getRow()) || ({} as Partial<SecureRow>);
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
  const r = (await getRow()) || ({} as Partial<SecureRow>);
  return {
    username: str(r.sms_username) || config.sms.username,
    apiKey: str(r.sms_api_key) || config.sms.apiKey,
    senderId: str(r.sms_sender_id) || config.sms.senderId,
  };
}

export async function getEffectiveSmtp() {
  const r = (await getRow()) || ({} as Partial<SecureRow>);
  const port = r.smtp_port != null ? r.smtp_port : config.smtp.port;
  return {
    host: str(r.smtp_host) || config.smtp.host,
    port,
    secure: r.smtp_secure != null ? /^yes$/i.test(str(r.smtp_secure)) : config.smtp.secure,
    user: str(r.smtp_user) || config.smtp.user,
    pass: str(r.smtp_pass) || config.smtp.pass,
    from: str(r.smtp_from) || config.smtp.from,
  };
}
