import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireAuth, HttpError } from "@/lib/http";
import { findAuth, updateProfile } from "@/lib/auth-store";

export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "PATCH");
  const claims = requireAuth(req);

  const row = await findAuth(claims.email);
  if (!row) throw new HttpError(404, "Account not found");

  // Only the phone number is customer-editable. Email is their identity and the
  // name comes from the utility's records — both are preserved server-side here,
  // so any `email`/`full_name` in the request body is ignored.
  const { phone } = (req.body || {}) as Record<string, string>;
  const newPhone = typeof phone === "string" ? phone.trim() : row.phone;

  if (newPhone && !/^[+\d][\d\s-]{6,19}$/.test(newPhone)) {
    throw new HttpError(400, "Enter a valid phone number");
  }

  await updateProfile(row.objectid, { fullName: row.full_name, phone: newPhone || null });

  res.status(200).json({
    user: { email: row.email, name: row.full_name, phone: newPhone || null },
  });
});
