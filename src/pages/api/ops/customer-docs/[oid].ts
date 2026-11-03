import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireOps, HttpError } from "@/lib/http";
import { assertServerConfig } from "@/lib/config";
import { getCustomerDoc, setCustomerDoc, deleteCustomerDoc } from "@/lib/customer-docs";

/**
 * A single customer's national-ID document, keyed by the Water_Customers OBJECTID.
 *
 * GET    → streams the document inline (image or PDF) for viewing, or 404 if none.
 * POST   { document: "data:<type>;base64,…" } → stores it (replacing any existing).
 * DELETE → removes it.
 *
 * Gated by the ops OAuth session; the bytes are read/written with the admin token
 * server-side (see customer-docs.ts). The document never reaches an
 * unauthenticated caller.
 */

// The document arrives as a base64 data URL, so allow a larger JSON body.
export const config = { api: { bodyParser: { sizeLimit: "12mb" } } };

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB decoded

export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "GET", "POST", "DELETE");
  requireOps(req);
  assertServerConfig();

  const oid = Number(req.query.oid);
  if (!Number.isInteger(oid)) throw new HttpError(400, "Invalid customer id");

  if (req.method === "GET") {
    const doc = await getCustomerDoc(oid);
    if (!doc) throw new HttpError(404, "No national ID document on file");
    res.setHeader("Content-Type", doc.contentType);
    res.setHeader("Content-Disposition", `inline; filename="${doc.name.replace(/"/g, "")}"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(doc.data);
  }

  if (req.method === "DELETE") {
    await deleteCustomerDoc(oid);
    return res.status(200).json({ ok: true });
  }

  // POST — upload / replace the document.
  const { document } = (req.body || {}) as Record<string, string>;
  if (!document || typeof document !== "string") throw new HttpError(400, "No document provided");

  const match = /^data:([^;]+);base64,(.+)$/.exec(document);
  if (!match) throw new HttpError(400, "Document must be a base64 data URL");
  const contentType = match[1].toLowerCase();
  const ext = ALLOWED[contentType];
  if (!ext) throw new HttpError(400, "Document must be a PDF or PNG/JPEG/WebP/GIF image");

  const data = Buffer.from(match[2], "base64");
  if (!data.length) throw new HttpError(400, "Document is empty");
  if (data.length > MAX_BYTES) throw new HttpError(413, "Document must be 8 MB or smaller");

  await setCustomerDoc(oid, data, `national-id.${ext}`, contentType);
  res.status(200).json({ ok: true });
});
