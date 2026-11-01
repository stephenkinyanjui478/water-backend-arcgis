import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { withApi, requireMethod, HttpError, setTempCookie } from "@/lib/http";
import { config } from "@/lib/config";
import { authorizeUrl } from "@/lib/ops-oauth";

/**
 * Kick off the ArcGIS OAuth flow: set a CSRF `state` cookie and redirect the
 * browser to the portal's sign-in/consent screen.
 */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "GET");
  if (!config.ops.clientId || !config.ops.clientSecret) {
    throw new HttpError(503, "Operations console OAuth is not configured");
  }
  const state = crypto.randomBytes(16).toString("hex");
  setTempCookie(res, "ops_oauth_state", state, 600);
  res.writeHead(302, { Location: authorizeUrl(state) }).end();
});
