import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireAuth, HttpError } from "@/lib/http";
import { findAuth, updateProfile } from "@/lib/auth-store";

export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "PATCH");
  const claims = requireAuth(req);

  const row = await findAuth(claims.email);
  if (!row) throw new HttpError(404, "Account not found");

  const { full_name, phone } = (req.body || {}) as Record<string, string>;
  const fullName = typeof full_name === "string" ? full_name.trim() : row.full_name;
  const newPhone = typeof phone === "string" ? phone.trim() : row.phone;

  if (fullName !== null && fullName !== undefined && fullName.length > 150) {
    throw new HttpError(400, "Name is too long");
  }
  if (newPhone && !/^[+\d][\d\s-]{6,19}$/.test(newPhone)) {
    throw new HttpError(400, "Enter a valid phone number");
  }

  await updateProfile(row.objectid, { fullName: fullName || null, phone: newPhone || null });

  res.status(200).json({
    user: { email: row.email, name: fullName || null, phone: newPhone || null },
  });
});
