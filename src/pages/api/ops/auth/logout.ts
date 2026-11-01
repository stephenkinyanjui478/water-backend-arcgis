import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, clearOpsCookie, OPS_COOKIE } from "@/lib/http";
import { verifyOps } from "@/lib/jwt";
import { destroyOpsSession } from "@/lib/ops-sessions";

/** Sign out: drop the server-side session (and its stored ArcGIS token) and clear
 *  the ops session cookie. */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "POST");
  const cookie = req.cookies?.[OPS_COOKIE];
  if (cookie) {
    try {
      const claims = verifyOps(cookie);
      if (claims.sid) destroyOpsSession(claims.sid);
    } catch {
      /* already invalid — nothing to destroy */
    }
  }
  clearOpsCookie(res);
  res.status(204).end();
});
