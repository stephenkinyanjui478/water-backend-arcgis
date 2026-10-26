import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, HttpError } from "@/lib/http";
import { assertServerConfig } from "@/lib/config";
import { emailExistsInSystem, findAuth, createAuth } from "@/lib/auth-store";
import { signSession } from "@/lib/jwt";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "POST");
  assertServerConfig();

  const { email, password, full_name, phone } = (req.body || {}) as Record<string, string>;
  if (!email || !EMAIL_RE.test(email)) throw new HttpError(400, "A valid email is required");
  if (!password || password.length < 8) throw new HttpError(400, "Password must be at least 8 characters");

  // The customer must already exist in the utility's records.
  const known = await emailExistsInSystem(email);
  if (!known.exists) {
    throw new HttpError(404, "No water account was found for this email. Contact support to be registered.");
  }

  if (await findAuth(email)) {
    throw new HttpError(409, "An account with this email already exists. Please sign in.");
  }

  const row = await createAuth({
    email,
    password,
    fullName: full_name || known.fullName,
    phone: phone || known.phone,
  });

  const token = signSession({ sub: row.email, email: row.email, name: row.full_name || undefined });
  res.status(201).json({ token, user: { email: row.email, name: row.full_name, phone: row.phone } });
});
