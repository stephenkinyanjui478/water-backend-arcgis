import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, HttpError } from "@/lib/http";
import { assertServerConfig } from "@/lib/config";
import { findAuth, verifyPassword, touchLastLogin } from "@/lib/auth-store";
import { signSession } from "@/lib/jwt";

export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "POST");
  assertServerConfig();

  const { email, password } = (req.body || {}) as Record<string, string>;
  if (!email || !password) throw new HttpError(400, "Email and password are required");

  const row = await findAuth(email);
  // Constant-ish failure path — same message whether the email or password is wrong.
  const ok = row ? await verifyPassword(password, row.pwd_hash) : false;
  if (!row || !ok) throw new HttpError(401, "Invalid email or password");
  if (row.status && row.status !== "Active") throw new HttpError(403, "This account is not active");

  await touchLastLogin(row.objectid);
  const token = signSession({ sub: row.email, email: row.email, name: row.full_name || undefined });
  res.status(200).json({ token, user: { email: row.email, name: row.full_name, phone: row.phone } });
});
