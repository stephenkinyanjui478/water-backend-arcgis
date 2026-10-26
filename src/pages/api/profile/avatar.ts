import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireAuth, HttpError } from "@/lib/http";
import { findAuth, setAvatar, getAvatar } from "@/lib/auth-store";

// Allow a larger JSON body — the image arrives as a base64 data URL.
export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB decoded

export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "GET", "POST");
  const claims = requireAuth(req);

  const row = await findAuth(claims.email);
  if (!row) throw new HttpError(404, "Account not found");

  if (req.method === "GET") {
    const avatar = await getAvatar(row.objectid);
    if (!avatar) return res.status(200).json({ dataUrl: null });
    const dataUrl = `data:${avatar.contentType};base64,${avatar.data.toString("base64")}`;
    return res.status(200).json({ dataUrl });
  }

  // POST — upload / replace the photo.
  const { image } = (req.body || {}) as Record<string, string>;
  if (!image || typeof image !== "string") throw new HttpError(400, "No image provided");

  const match = /^data:([^;]+);base64,(.+)$/.exec(image);
  if (!match) throw new HttpError(400, "Image must be a base64 data URL");
  const contentType = match[1].toLowerCase();
  const ext = ALLOWED[contentType];
  if (!ext) throw new HttpError(400, "Photo must be a JPEG, PNG, WebP or GIF image");

  const data = Buffer.from(match[2], "base64");
  if (!data.length) throw new HttpError(400, "Image is empty");
  if (data.length > MAX_BYTES) throw new HttpError(413, "Photo must be 2 MB or smaller");

  await setAvatar(row.objectid, data, `avatar.${ext}`, contentType);
  res.status(200).json({ ok: true });
});
