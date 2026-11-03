/**
 * Credential store over the PRIVATE Water_CustomerAuth table. Only ever touched
 * server-side with the admin token. Passwords are bcrypt-hashed before they land
 * here; plain passwords never leave the request handler.
 */
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { config } from "@/lib/config";
import {
  queryLayer,
  insertOne,
  applyEdits,
  countLayer,
  sqlEscape,
  listAttachments,
  addAttachment,
  deleteAttachments,
  fetchAttachment,
} from "@/lib/arcgis";

export interface AuthRow {
  objectid: number;
  email: string;
  pwd_hash: string;
  full_name: string | null;
  phone: string | null;
  status: string | null;
  /** 1 ⇒ the customer must change their (temporary) password before using the app. */
  must_reset: number | null;
}

/** Mirror a customer's editable contact fields onto their login row, located by
 *  their CURRENT (pre-edit) email. No-op if they have no login. Used when a
 *  customer is edited in the operations console so name/phone/email stay in sync
 *  (email is the login identity, so it's kept aligned too). */
export async function updateAuthContact(
  currentEmail: string,
  input: { fullName: string | null; phone: string | null; email: string }
): Promise<void> {
  const row = await findAuth(currentEmail);
  if (!row) return;
  await applyEdits(config.layers.customerAuth, {
    updates: [
      {
        attributes: {
          objectid: row.objectid,
          full_name: input.fullName,
          phone: input.phone,
          email: input.email.toLowerCase(),
        },
      },
    ],
  });
}

/** Delete the login(s) for an email (admin token). Used when a customer is
 *  removed in the operations console so their portal access is revoked too. */
export async function deleteAuthByEmail(email: string): Promise<void> {
  const rows = await queryLayer<{ objectid: number }>(config.layers.customerAuth, {
    where: `LOWER(email)='${sqlEscape(email.toLowerCase())}'`,
    outFields: "objectid",
  });
  if (!rows.length) return;
  await applyEdits(config.layers.customerAuth, { deletes: rows.map((r) => r.objectid) });
}

export async function findAuth(email: string): Promise<AuthRow | null> {
  const rows = await queryLayer<AuthRow>(config.layers.customerAuth, {
    where: `LOWER(email)='${sqlEscape(email.toLowerCase())}'`,
    outFields: "objectid,email,pwd_hash,full_name,phone,status,must_reset",
  });
  return rows[0] || null;
}

/**
 * A random, unambiguous temporary password (default 8 chars). Used when the
 * operations console provisions a login — the customer must reset it on first
 * sign-in. The charset omits easily-confused glyphs (0/O, 1/l/I).
 */
export function generateTempPassword(length = 8): string {
  const charset = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += charset[bytes[i] % charset.length];
  return out;
}

/** A customer may only register if the water utility already knows their email. */
export async function emailExistsInSystem(
  email: string
): Promise<{ exists: boolean; fullName: string | null; phone: string | null }> {
  const e = sqlEscape(email.toLowerCase());
  const custs = await queryLayer<{ cust_name: string; phone: string }>(config.layers.customers, {
    where: `LOWER(email)='${e}'`,
    outFields: "cust_name,phone",
  });
  if (custs.length) {
    return { exists: true, fullName: custs[0].cust_name || null, phone: custs[0].phone || null };
  }
  const reads = await queryLayer<{ cust_name: string; phone: string }>(config.layers.meterReadings, {
    where: `LOWER(email)='${e}'`,
    outFields: "cust_name,phone",
  });
  if (reads.length) {
    return { exists: true, fullName: reads[0].cust_name || null, phone: reads[0].phone || null };
  }
  return { exists: false, fullName: null, phone: null };
}

export async function createAuth(input: {
  email: string;
  password: string;
  fullName: string | null;
  phone: string | null;
  /** When true, the customer must change this password on first sign-in. */
  mustReset?: boolean;
}): Promise<AuthRow> {
  const pwd_hash = await bcrypt.hash(input.password, config.bcryptRounds);
  const now = Date.now();
  const must_reset = input.mustReset ? 1 : 0;
  const attributes = {
    email: input.email.toLowerCase(),
    pwd_hash,
    full_name: input.fullName,
    phone: input.phone,
    status: "Active",
    created_ts: now,
    last_login: now,
    must_reset,
  };
  const objectid = await insertOne(config.layers.customerAuth, attributes);
  return { objectid, email: attributes.email, pwd_hash, full_name: input.fullName, phone: input.phone, status: "Active", must_reset };
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function touchLastLogin(objectid: number): Promise<void> {
  await applyEdits(config.layers.customerAuth, {
    updates: [{ attributes: { objectid, last_login: Date.now() } }],
  });
}

export async function authCount(): Promise<number> {
  return countLayer(config.layers.customerAuth);
}

/** Update the customer's editable profile fields (name / phone). */
export async function updateProfile(
  objectid: number,
  input: { fullName: string | null; phone: string | null }
): Promise<void> {
  await applyEdits(config.layers.customerAuth, {
    updates: [{ attributes: { objectid, full_name: input.fullName, phone: input.phone } }],
  });
}

/** Replace the customer's password hash and clear any pending reset requirement.
 *  Caller must authenticate the customer first (current password or a valid session). */
export async function updatePassword(objectid: number, newPassword: string): Promise<void> {
  const pwd_hash = await bcrypt.hash(newPassword, config.bcryptRounds);
  await applyEdits(config.layers.customerAuth, {
    updates: [{ attributes: { objectid, pwd_hash, must_reset: 0 } }],
  });
}

/** Set (replacing any existing) the customer's profile photo as a row attachment. */
export async function setAvatar(
  objectid: number,
  data: Buffer,
  filename: string,
  contentType: string
): Promise<void> {
  const existing = await listAttachments(config.layers.customerAuth, objectid);
  await deleteAttachments(
    config.layers.customerAuth,
    objectid,
    existing.map((a) => a.id)
  );
  await addAttachment(config.layers.customerAuth, objectid, data, filename, contentType);
}

/** Fetch the customer's profile photo bytes, or null if they have none. */
export async function getAvatar(
  objectid: number
): Promise<{ data: Buffer; contentType: string } | null> {
  const existing = await listAttachments(config.layers.customerAuth, objectid);
  if (!existing.length) return null;
  // The most recently added attachment is the current avatar.
  const latest = existing[existing.length - 1];
  return fetchAttachment(config.layers.customerAuth, objectid, latest.id);
}
