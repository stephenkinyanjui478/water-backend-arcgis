import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, setOpsCookie, setTempCookie } from "@/lib/http";
import { config } from "@/lib/config";
import { exchangeCode, fetchSelf, isOpsMember } from "@/lib/ops-oauth";
import { createOpsSession } from "@/lib/ops-sessions";
import { signOps } from "@/lib/jwt";

/**
 * OAuth redirect target. Validates `state`, exchanges the `code` for an ArcGIS
 * token (server-side, with the client secret), mints an ops session cookie, and
 * sends the operator back to the console. Any failure bounces to /login?error=.
 */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "GET");

  const fail = (msg: string) => {
    setTempCookie(res, "ops_oauth_state", "", 0); // clear state
    res.writeHead(302, { Location: `${config.ops.consoleUrl}/login?error=${encodeURIComponent(msg)}` }).end();
  };

  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const expected = req.cookies?.ops_oauth_state;

  if (req.query.error) return fail(String(req.query.error_description || req.query.error));
  if (!code) return fail("Sign-in was cancelled");
  if (!state || !expected || state !== expected) return fail("Invalid sign-in state");

  try {
    const tok = await exchangeCode(code);
    const self = await fetchSelf(tok.access_token);

    // Entry gate (Decision 1): must be a member of the configured ops group.
    if (!isOpsMember(self)) {
      setTempCookie(res, "ops_oauth_state", "", 0);
      return fail("Your portal account doesn't have access to the operations console.");
    }

    // Model A: keep the operator's ArcGIS token server-side; the cookie carries
    // only the session id. Data ops then run under their portal identity.
    const sid = createOpsSession({
      username: tok.username,
      accessToken: tok.access_token,
      accessExpires: Date.now() + (tok.expires_in || 0) * 1000,
      refreshToken: tok.refresh_token,
    });

    const session = signOps({
      sub: tok.username,
      username: tok.username,
      fullName: self.fullName,
      role: self.role,
      sid,
    });
    setTempCookie(res, "ops_oauth_state", "", 0); // consume state
    setOpsCookie(res, session);
    res.writeHead(302, { Location: config.ops.consoleUrl }).end();
  } catch (err: any) {
    console.error("[ops oauth callback]", err);
    fail("Could not complete sign-in");
  }
});
