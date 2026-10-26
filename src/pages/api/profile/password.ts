import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireAuth, HttpError } from "@/lib/http";
import { findAuth, verifyPassword, updatePassword } from "@/lib/auth-store";

export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "POST");
  const claims = requireAuth(req);

  const { currentPassword, newPassword } = (req.body || {}) as Record<string, string>;
  if (!currentPassword) throw new HttpError(400, "Enter your current password");
  if (!newPassword || newPassword.length < 8) {
    throw new HttpError(400, "New password must be at least 8 characters");
  }
  if (newPassword === currentPassword) {
    throw new HttpError(400, "New password must be different from the current one");
  }

  const row = await findAuth(claims.email);
  if (!row) throw new HttpError(404, "Account not found");

  const ok = await verifyPassword(currentPassword, row.pwd_hash);
  if (!ok) throw new HttpError(401, "Your current password is incorrect");

  await updatePassword(row.objectid, newPassword);
  res.status(200).json({ ok: true });
});
