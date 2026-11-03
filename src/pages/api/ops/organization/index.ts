import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireOps } from "@/lib/http";
import { assertServerConfig } from "@/lib/config";
import { getOrganization, updateOrganization, type OrgPatch } from "@/lib/settings-store";

/**
 * Operations-console view of the whole organization record (profile, support
 * contacts, M-Pesa / SMS / Email settings and notification settings), backed by
 * the PRIVATE single-row Water_Organization table. Gated by the ops OAuth session.
 *
 * GET  returns the full record with SECRET fields MASKED (only `*Set` flags) — no
 *      raw secret ever leaves the server.
 * PUT  upserts the single row; a blank secret field keeps the stored value.
 */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "GET", "PUT");
  requireOps(req);
  assertServerConfig();

  if (req.method === "GET") {
    res.status(200).json(await getOrganization());
    return;
  }

  await updateOrganization((req.body || {}) as OrgPatch);
  res.status(200).json(await getOrganization());
});
