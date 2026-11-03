/**
 * Customer national-ID document — stored as a binary ATTACHMENT on the customer's
 * Water_Customers row. Each customer carries at most one such document; uploading
 * a new one replaces whatever was there (the latest attachment is authoritative,
 * mirroring the profile-photo pattern in auth-store.ts).
 *
 * The bytes are read/written server-side with the admin token (see arcgis.ts) and
 * only ever reach the browser through the ops-session-gated backend route, so the
 * document is never exposed to an unauthenticated caller.
 */
import { config } from "@/lib/config";
import {
  listAttachments,
  addAttachment,
  deleteAttachments,
  fetchAttachment,
  queryAttachments,
} from "@/lib/arcgis";

const LAYER = config.layers.customers;

/** OBJECTIDs of customers that have a national-ID document on file. */
export async function listCustomerDocOids(): Promise<number[]> {
  const groups = await queryAttachments(LAYER);
  return Object.entries(groups)
    .filter(([, infos]) => infos.length > 0)
    .map(([oid]) => Number(oid));
}

/** Store (replacing any existing) the customer's national-ID document. */
export async function setCustomerDoc(
  oid: number,
  data: Buffer,
  filename: string,
  contentType: string
): Promise<void> {
  const existing = await listAttachments(LAYER, oid);
  await deleteAttachments(LAYER, oid, existing.map((a) => a.id));
  await addAttachment(LAYER, oid, data, filename, contentType);
}

/** Remove the customer's national-ID document(s), if any. */
export async function deleteCustomerDoc(oid: number): Promise<void> {
  const existing = await listAttachments(LAYER, oid);
  await deleteAttachments(LAYER, oid, existing.map((a) => a.id));
}

/** Fetch the customer's national-ID document bytes, or null if they have none. */
export async function getCustomerDoc(
  oid: number
): Promise<{ data: Buffer; contentType: string; name: string } | null> {
  const existing = await listAttachments(LAYER, oid);
  if (!existing.length) return null;
  // The most recently added attachment is the current document.
  const latest = existing[existing.length - 1];
  const { data, contentType } = await fetchAttachment(LAYER, oid, latest.id);
  return { data, contentType, name: latest.name };
}
