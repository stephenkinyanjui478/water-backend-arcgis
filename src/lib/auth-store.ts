/**
 * Credential store over the PRIVATE Water_CustomerAuth table. Only ever touched
 * server-side with the admin token. Passwords are bcrypt-hashed before they land
 * here; plain passwords never leave the request handler.
 */
import bcrypt from "bcryptjs";
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
}

export async function findAuth(email: string): Promise<AuthRow | null> {
  const rows = await queryLayer<AuthRow>(config.layers.customerAuth, {
    where: `LOWER(email)='${sqlEscape(email.toLowerCase())}'`,
    outFields: "objectid,email,pwd_hash,full_name,phone,status",
  });
  return rows[0] || null;
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
}): Promise<AuthRow> {
  const pwd_hash = await bcrypt.hash(input.password, config.bcryptRounds);
  const now = Date.now();
  const attributes = {
    email: input.email.toLowerCase(),
    pwd_hash,
    full_name: input.fullName,
    phone: input.phone,
    status: "Active",
    created_ts: now,
    last_login: now,
  };
  const objectid = await insertOne(config.layers.customerAuth, attributes);
  return { objectid, email: attributes.email, pwd_hash, full_name: input.fullName, phone: input.phone, status: "Active" };
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

/** Replace the customer's password hash. Caller must verify the current password first. */
export async function updatePassword(objectid: number, newPassword: string): Promise<void> {
  const pwd_hash = await bcrypt.hash(newPassword, config.bcryptRounds);
  await applyEdits(config.layers.customerAuth, {
    updates: [{ attributes: { objectid, pwd_hash } }],
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
