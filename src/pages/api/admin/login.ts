import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { withApi, requireMethod, HttpError } from "@/lib/http";
import { config } from "@/lib/config";
import { signAdmin } from "@/lib/jwt";

/**
 * Admin sign-in for the static WSP client's Organization → Communications tab.
 * Verifies the admin password (ADMIN_PASSWORD) and issues a short-lived admin JWT.
 */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "POST");

  if (!config.admin.password) {
    throw new HttpError(503, "Admin console is not configured (set ADMIN_PASSWORD).");
  }

  const { password } = (req.body || {}) as Record<string, string>;
  if (!password) throw new HttpError(400, "Password is required");

  if (!timingSafeEqual(password, config.admin.password)) {
    throw new HttpError(401, "Incorrect admin password");
  }

  res.status(200).json({ token: signAdmin() });
});

/** Length-independent constant-time string comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still run a compare to avoid leaking length via timing.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}
