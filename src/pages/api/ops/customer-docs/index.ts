import type { NextApiRequest, NextApiResponse } from "next";
import { withApi, requireMethod, requireOps } from "@/lib/http";
import { assertServerConfig } from "@/lib/config";
import { listCustomerDocOids } from "@/lib/customer-docs";

/**
 * Index of which customers have a national-ID document on file. The console loads
 * it once to flag rows in the Customers table (no per-row round-trips).
 *
 * GET → { ids: number[] }  — OBJECTIDs of customers with a document.
 *
 * Gated by the ops OAuth session; attachment bytes are read with the admin token
 * server-side (see customer-docs.ts).
 */
export default withApi(async (req: NextApiRequest, res: NextApiResponse) => {
  requireMethod(req, "GET");
  requireOps(req);
  assertServerConfig();

  const ids = await listCustomerDocOids();
  res.status(200).json({ ids });
});
