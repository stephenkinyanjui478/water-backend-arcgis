import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireAuth, HttpError } from "@/lib/http";
import { findAuth, updatePassword } from "@/lib/auth-store";

/**
 * First-sign-in password reset. When the operations console provisions a login it
 * issues a temporary password with must_reset = 1; the customer app forces this
 * endpoint before letting them in. It is authenticated by the session they just
 * established with the temporary password, so no current password is re-entered —
 * but it is ONLY permitted while a reset is actually pending, so it can't be used
 * to bypass the normal current-password check for an ordinary change.
 */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "POST");
  const claims = requireAuth(req);

  const { newPassword } = (req.body || {}) as Record<string, string>;
  if (!newPassword || newPassword.length < 8) {
    throw new HttpError(400, "New password must be at least 8 characters");
  }

  const row = await findAuth(claims.email);
  if (!row) throw new HttpError(404, "Account not found");
  if (row.must_reset !== 1) throw new HttpError(400, "No password reset is required for this account");

  await updatePassword(row.objectid, newPassword); // also clears must_reset
  res.status(200).json({ ok: true });
});
