import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireOps, HttpError } from "@/lib/http";
import { hasOpsSession } from "@/lib/ops-sessions";

/** Return the signed-in operator's identity (gates the console UI). A valid cookie
 *  whose server-side session is gone (e.g. after a backend restart) is treated as
 *  signed-out (401), so the console cleanly redirects to the portal sign-in. */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "GET");
  const claims = requireOps(req);
  if (!claims.sid || !hasOpsSession(claims.sid)) {
    throw new HttpError(401, "Session expired");
  }
  res.status(200).json({
    username: claims.username,
    fullName: claims.fullName || claims.username,
    role: claims.role || "",
  });
});
