import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireOps, HttpError } from "@/lib/http";
import { assertServerConfig } from "@/lib/config";
import { getOrgLogo, setOrgLogo, deleteOrgLogo } from "@/lib/settings-store";

/**
 * Organization logo — stored as a binary ATTACHMENT on the single-row private
 * Water_Organization record (not inline in a feature field, so full-size images
 * are supported). Gated by the ops OAuth session; the bytes are read/written
 * server-side with the admin token and returned to the console as a data URL.
 *
 * GET    → { dataUrl: string | null }  — the current logo, or null if none.
 * POST   { image: "data:<type>;base64,…" } → stores it (≤ 2 MB). Returns { ok }.
 * DELETE → removes the logo. Returns { ok }.
 */

// The image arrives as a base64 data URL, so allow a larger JSON body.
export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB decoded

export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "GET", "POST", "DELETE");
  requireOps(req);
  assertServerConfig();

  if (req.method === "GET") {
    const logo = await getOrgLogo();
    if (!logo) return res.status(200).json({ dataUrl: null });
    const dataUrl = `data:${logo.contentType};base64,${logo.data.toString("base64")}`;
    return res.status(200).json({ dataUrl });
  }

  if (req.method === "DELETE") {
    await deleteOrgLogo();
    return res.status(200).json({ ok: true });
  }

  // POST — upload / replace the logo.
  const { image } = (req.body || {}) as Record<string, string>;
  if (!image || typeof image !== "string") throw new HttpError(400, "No image provided");

  const match = /^data:([^;]+);base64,(.+)$/.exec(image);
  if (!match) throw new HttpError(400, "Image must be a base64 data URL");
  const contentType = match[1].toLowerCase();
  const ext = ALLOWED[contentType];
  if (!ext) throw new HttpError(400, "Logo must be a PNG, JPEG, WebP, GIF or SVG image");

  const data = Buffer.from(match[2], "base64");
  if (!data.length) throw new HttpError(400, "Image is empty");
  if (data.length > MAX_BYTES) throw new HttpError(413, "Logo must be 2 MB or smaller");

  await setOrgLogo(data, `logo.${ext}`, contentType);
  res.status(200).json({ ok: true });
});
